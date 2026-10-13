import type { ResolvedPlan, RideEvent, RideRecording, RideSample } from '../data/schema';
import { interpolatedTargetW, targetAt } from './planResolve';

// Per-ride training metrics, computed from the 1 Hz samples after a ride
// (and recomputed for old rides whenever METRICS_VERSION changes). Everything
// here is pure. Definitions follow Coggan (NP, IF, TSS) and Friel (EF,
// decoupling); the in-app glossary (ui/glossary.ts) explains each one.

export const METRICS_VERSION = 'metrics-v1';

export interface RideMetrics {
  version: typeof METRICS_VERSION;
  recordingId: string;
  date: string; // local calendar date of the ride, YYYY-MM-DD
  ftpUsed: number | null;
  // Seconds with a power reading (gaps excluded).
  movingS: number;
  avgPowerW: number | null;
  normalizedPowerW: number | null;
  intensityFactor: number | null;
  tss: number | null;
  avgHrBpm: number | null;
  // Normalized power / average heart rate. Rises as aerobic fitness improves.
  efficiencyFactor: number | null;
  // Power:HR drift between the halves of the longest steady block (>= 20 min).
  // Positive = heart rate drifted up at constant power.
  decouplingPct: number | null;
  // Share of riding time within tolerance of the ERG target (workouts only).
  compliancePct: number | null;
  // Highest IF the plan asked for: separates key sessions from easy rides.
  plannedPeakIntensity: number | null;
}

const NP_WINDOW_S = 30;
const DECOUPLING_MIN_BLOCK_S = 20 * 60;
const DECOUPLING_SETTLE_S = 180;
const COMPLIANCE_SETTLE_S = 15;

export function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Coggan's normalized power: 30 s rolling average, fourth power, mean, fourth
// root. Weights hard moments more than easy ones. Needs >= 30 s of power.
export function normalizedPower(power: number[]): number | null {
  if (power.length < NP_WINDOW_S) return null;
  let sum = 0;
  let fourth = 0;
  let n = 0;
  for (let i = 0; i < power.length; i++) {
    sum += power[i];
    if (i >= NP_WINDOW_S) sum -= power[i - NP_WINDOW_S];
    if (i >= NP_WINDOW_S - 1) {
      const avg = sum / NP_WINDOW_S;
      fourth += avg ** 4;
      n++;
    }
  }
  return n ? Math.pow(fourth / n, 0.25) : null;
}

// TSS of `durationS` seconds at normalized power `np`: 1 h at FTP = 100.
export function trainingStress(durationS: number, np: number, ftp: number): number {
  const intensity = np / ftp;
  return ((durationS * np * intensity) / (ftp * 3600)) * 100;
}

// Which samples were taken while the ride was actually in progress (not
// paused or interrupted), and the plan time at each, both derived from the
// event log. Returns one entry per sample.
function ridingTimeline(samples: RideSample[], events: RideEvent[]): { riding: boolean; planS: number }[] {
  const toggles = events
    .filter((e) => ['start', 'pause', 'resume', 'deviceDisconnected', 'deviceReconnected', 'finish'].includes(e.type))
    .map((e) => ({ at: e.elapsedS, riding: e.type === 'start' || e.type === 'resume' }));
  let idx = 0;
  let riding = false;
  let planS = 0;
  let prevT = 0;
  return samples.map((s) => {
    while (idx < toggles.length && toggles[idx].at <= s.elapsedS) {
      riding = toggles[idx].riding;
      idx++;
    }
    if (riding) planS += s.elapsedS - prevT;
    prevT = s.elapsedS;
    return { riding, planS };
  });
}

function decoupling(plan: ResolvedPlan, samples: RideSample[], timeline: { riding: boolean; planS: number }[]): number | null {
  const steady = plan.steps
    .filter((s) => s.targetEndW === undefined && s.endS - s.startS >= DECOUPLING_MIN_BLOCK_S)
    .sort((a, b) => b.endS - b.startS - (a.endS - a.startS))[0];
  if (!steady) return null;
  const inBlock = samples.filter((s, i) => {
    const t = timeline[i];
    return t.riding && t.planS >= steady.startS + DECOUPLING_SETTLE_S && t.planS < steady.endS && s.powerW !== null && s.hrBpm !== null;
  }) as (RideSample & { powerW: number; hrBpm: number })[];
  if (inBlock.length < (DECOUPLING_MIN_BLOCK_S - DECOUPLING_SETTLE_S) * 0.8) return null;
  const half = Math.floor(inBlock.length / 2);
  const ratio = (xs: typeof inBlock) => {
    const p = xs.reduce((a, s) => a + s.powerW, 0) / xs.length;
    const h = xs.reduce((a, s) => a + s.hrBpm, 0) / xs.length;
    return h > 0 ? p / h : null;
  };
  const first = ratio(inBlock.slice(0, half));
  const second = ratio(inBlock.slice(half));
  if (first === null || second === null || first === 0) return null;
  return ((first - second) / first) * 100;
}

function compliance(plan: ResolvedPlan, samples: RideSample[], timeline: { riding: boolean; planS: number }[]): number | null {
  let counted = 0;
  let within = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const t = timeline[i];
    if (!t.riding || s.powerW === null) continue;
    const step = targetAt(plan, t.planS);
    if (!step || t.planS - step.startS < COMPLIANCE_SETTLE_S) continue;
    const target = interpolatedTargetW(step, t.planS);
    const tolerance = Math.max(10, target * 0.05);
    counted++;
    if (Math.abs(s.powerW - target) <= tolerance) within++;
  }
  return counted >= 60 ? (within / counted) * 100 : null;
}

// Planned peak intensity: the hardest step as a fraction of FTP.
export function plannedPeakIntensity(plan: ResolvedPlan | null, ftp: number | null): number | null {
  if (!plan || !ftp) return null;
  return Math.max(...plan.steps.map((s) => Math.max(s.targetW, s.targetEndW ?? 0))) / ftp;
}

export function computeRideMetrics(
  recording: RideRecording,
  samples: RideSample[],
  fallbackFtp: number | null = null,
): RideMetrics {
  const ftp = recording.ftpUsed ?? fallbackFtp;
  const powered = samples.filter((s) => s.powerW !== null) as (RideSample & { powerW: number })[];
  const power = powered.map((s) => s.powerW);
  const hrs = samples.filter((s) => s.hrBpm !== null).map((s) => s.hrBpm as number);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avgPowerW = avg(power);
  const np = normalizedPower(power);
  const intensityFactor = np !== null && ftp ? np / ftp : null;
  const tss = np !== null && ftp ? trainingStress(power.length, np, ftp) : null;
  const avgHrBpm = avg(hrs);
  const efficiencyFactor = np !== null && avgHrBpm ? np / avgHrBpm : null;

  const plan = recording.resolvedPlan;
  const timeline = plan ? ridingTimeline(samples, recording.events) : [];
  const isErgWorkout = recording.kind === 'workout' && recording.mode === 'erg' && !!plan;

  return {
    version: METRICS_VERSION,
    recordingId: recording.id,
    date: localDate(recording.startedAt),
    ftpUsed: ftp,
    movingS: power.length,
    avgPowerW,
    normalizedPowerW: np,
    intensityFactor,
    tss,
    avgHrBpm,
    efficiencyFactor,
    decouplingPct: plan ? decoupling(plan, samples, timeline) : null,
    compliancePct: isErgWorkout ? compliance(plan, samples, timeline) : null,
    plannedPeakIntensity: plannedPeakIntensity(plan, ftp),
  };
}

// TSS a plan would produce if ridden exactly as written (ERG holds power at
// the target, so this is close to exact). Builds the 1 Hz target profile and
// runs it through the same NP/TSS math as a real ride.
export function plannedTss(plan: ResolvedPlan, ftp: number): number {
  const profile: number[] = [];
  for (const step of plan.steps) {
    for (let t = step.startS; t < step.endS; t++) profile.push(interpolatedTargetW(step, t));
  }
  const np = normalizedPower(profile);
  return np === null ? 0 : trainingStress(profile.length, np, ftp);
}
