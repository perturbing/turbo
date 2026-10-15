import type { RideSample } from '../data/schema';
import { aggregate, type AggregateThreshold, type RideThresholds } from './dfa';

// Physiological estimates from trainer data. None of these are measurements;
// each carries its method, its source date and a freshness rule, and the UI
// refuses to show a stale or missing one as if it were current.

export const PHYSIOLOGY = {
  // How long an estimate stays current.
  vo2maxMaxAgeDays: 56,
  cpMaxAgeDays: 56,
  thresholdWindowDays: 28,
  thresholdMinRides: 3,
  // Hawley & Noakes (1992): VO2max (L/min) = 0.01141 x MAP (W) + 0.435, with
  // MAP the peak 1-minute power of a ramp to exhaustion. Individual error ~7%.
  vo2maxSlope: 0.01141,
  vo2maxIntercept: 0.435,
  vo2maxErrorPct: 7,
  // Highest heart rate seen in any ride. It falls slowly with age, so a year
  // is a fair window; the tile says how old the observation is.
  hrMaxMaxAgeDays: 365,
  // 3-minute all-out test (Vanhatalo et al., 2007): CP = mean power of the
  // final 30 s, W' = work done above CP over the 180 s.
  allOutDurationS: 180,
  allOutEndWindowS: 30,
  minAllOutCoverage: 0.95,
  // An all-out start that is not much above the end was paced.
  pacedIfEndOverStart: 0.85,
  // A true all-out effort peaks in its first seconds; a peak (15 s mean) this
  // late means the rider was holding back.
  pacedIfPeakAfterS: 45,
  // Power settles to a plateau in the last minute. A final 30 s far below the
  // minute before it is a rider who stopped, not one who faded.
  stoppedIfEndOverPrevMinute: 0.7,
  // CP and FTP estimate the same boundary; a result this far from the FTP in
  // use came from a test that was not ridden as intended.
  cpPlausibleOfFtp: [0.6, 1.4] as const,
} as const;

export type Freshness = 'fresh' | 'stale';

export function freshness(sourceDate: string, maxAgeDays: number, today: string): Freshness {
  const age = (Date.parse(`${today}T12:00:00`) - Date.parse(sourceDate)) / 86_400_000;
  return age <= maxAgeDays ? 'fresh' : 'stale';
}

export interface Vo2maxEstimate {
  method: 'hawley-noakes-1992';
  mapW: number;
  litresPerMin: number;
  mlPerKgMin: number | null; // needs weight
  low: number | null;
  high: number | null;
}

export function vo2maxFromMap(mapW: number, weightKg: number | null): Vo2maxEstimate {
  const litresPerMin = PHYSIOLOGY.vo2maxSlope * mapW + PHYSIOLOGY.vo2maxIntercept;
  const rel = weightKg ? (litresPerMin * 1000) / weightKg : null;
  const err = PHYSIOLOGY.vo2maxErrorPct / 100;
  return {
    method: 'hawley-noakes-1992',
    mapW,
    litresPerMin,
    mlPerKgMin: rel,
    low: rel === null ? null : rel * (1 - err),
    high: rel === null ? null : rel * (1 + err),
  };
}

export interface RampHrMarkers {
  hrMaxBpm: number | null;
  // Mean HR in the minute after measured power first reaches the FTP estimate
  // (lag-compensated roughly; a ramp's HR trails power by 30-60 s).
  lthrBpm: number | null;
}

export function rampHrMarkers(samples: RideSample[], ftpEstimateW: number): RampHrMarkers {
  const hrs = samples.filter((s) => s.hrBpm !== null).map((s) => s.hrBpm as number);
  const hrMaxBpm = hrs.length ? Math.max(...hrs) : null;
  // 30 s rolling power to find the crossing.
  let lthrBpm: number | null = null;
  const pw = samples.map((s) => s.powerW);
  for (let i = 29; i < samples.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = i - 29; j <= i; j++) {
      if (pw[j] !== null) {
        sum += pw[j] as number;
        n++;
      }
    }
    if (n < 25 || sum / n < ftpEstimateW) continue;
    const after = samples.slice(i, i + 60).filter((s) => s.hrBpm !== null).map((s) => s.hrBpm as number);
    if (after.length >= 40) lthrBpm = after.reduce((a, b) => a + b, 0) / after.length;
    break;
  }
  return { hrMaxBpm, lthrBpm };
}

// Why an all-out test cannot be used, in order of precedence.
export type CpTestProblem = 'gaps' | 'stopped-early' | 'late-peak' | 'paced' | 'implausible';

export const CP_TEST_PROBLEM_TEXT: Record<CpTestProblem, string> = {
  gaps: 'the trainer dropped too much power data during the effort',
  'stopped-early': 'the effort stopped before the three minutes were up: the final 30 s were far below the minute before them',
  'late-peak': 'the peak came late, so the start was paced: go all out from the first pedal stroke',
  paced: 'the final 30 s were nearly as hard as the first 30 s, which means the start was paced',
  implausible: 'the result is too far from your FTP to be a real critical power',
};

export interface CpTestResult {
  method: 'all-out-3min-v2';
  cpW: number;
  wPrimeJ: number;
  meanPowerW: number;
  startPowerW: number; // first 30 s
  endPowerW: number; // last 30 s (= cpW)
  peakPowerW: number; // best 15 s mean
  peakAtS: number; // when that 15 s window ended, from the start of the step
  coverage: number; // share of the 180 s with a power reading
  // null when the test is usable. Otherwise the numbers above describe the
  // ride but must not be shown as a measurement.
  problem: CpTestProblem | null;
}

// Power samples of the all-out step, in order, one per second (nulls = gaps).
// `ftpW` is the FTP in use, for the plausibility check (skipped when null).
export function cpFromAllOut(power: (number | null)[], ftpW: number | null = null): CpTestResult | null {
  const dur = PHYSIOLOGY.allOutDurationS;
  const win = PHYSIOLOGY.allOutEndWindowS;
  const step = power.slice(0, dur);
  const have = step.filter((p): p is number => p !== null);
  if (!have.length) return null;
  const coverage = have.length / dur;
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((p): p is number => p !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  };
  const cpW = mean(step.slice(dur - win, dur));
  const meanPowerW = mean(step);
  const startPowerW = mean(step.slice(0, win));
  const prevMinuteW = mean(step.slice(dur - win - 60, dur - win));

  let peakPowerW = 0;
  let peakAtS = 0;
  for (let end = 15; end <= step.length; end++) {
    const m = mean(step.slice(end - 15, end));
    if (m > peakPowerW) {
      peakPowerW = m;
      peakAtS = end;
    }
  }

  let problem: CpTestProblem | null = null;
  if (coverage < PHYSIOLOGY.minAllOutCoverage) problem = 'gaps';
  else if (cpW < prevMinuteW * PHYSIOLOGY.stoppedIfEndOverPrevMinute) problem = 'stopped-early';
  else if (peakAtS > PHYSIOLOGY.pacedIfPeakAfterS) problem = 'late-peak';
  else if (cpW / startPowerW > PHYSIOLOGY.pacedIfEndOverStart) problem = 'paced';
  else if (ftpW && (cpW < ftpW * PHYSIOLOGY.cpPlausibleOfFtp[0] || cpW > ftpW * PHYSIOLOGY.cpPlausibleOfFtp[1])) problem = 'implausible';

  return {
    method: 'all-out-3min-v2',
    cpW,
    wPrimeJ: Math.max(0, (meanPowerW - cpW) * dur),
    meanPowerW,
    startPowerW,
    endPowerW: cpW,
    peakPowerW,
    peakAtS,
    coverage,
    problem,
  };
}

// The highest heart rate seen in any ride within the window: a maximum is
// only reached in a maximal effort, so the ride that produced it is named.
export interface HrMaxObservation {
  bpm: number;
  date: string; // ISO timestamp of the ride
  recordingId: string;
  fresh: Freshness;
}

export function hrMaxProfile(
  rides: { date: string; recordingId: string; maxHrBpm: number | null }[],
  today: string,
): HrMaxObservation | null {
  let best: HrMaxObservation | null = null;
  for (const r of rides) {
    if (r.maxHrBpm === null) continue;
    if (freshness(r.date, PHYSIOLOGY.hrMaxMaxAgeDays, today) !== 'fresh') continue;
    if (!best || r.maxHrBpm > best.bpm || (r.maxHrBpm === best.bpm && r.date > best.date)) {
      best = { bpm: r.maxHrBpm, date: r.date, recordingId: r.recordingId, fresh: 'fresh' };
    }
  }
  return best;
}

// Time to exhaustion at a power above CP, from the CP/W' model.
export function timeToExhaustionS(powerW: number, cpW: number, wPrimeJ: number): number | null {
  return powerW > cpW ? wPrimeJ / (powerW - cpW) : null;
}

export interface ThresholdProfile {
  rides: number;
  lt1W: AggregateThreshold | null;
  lt1Hr: AggregateThreshold | null;
  lt2W: AggregateThreshold | null;
  lt2Hr: AggregateThreshold | null;
}

// Pool the per-ride DFA thresholds of recent rides.
export function thresholdProfile(rides: { date: string; thresholds: RideThresholds | null }[], today: string): ThresholdProfile {
  const recent = rides.filter(
    (r) => r.thresholds && freshness(`${r.date}T12:00:00`, PHYSIOLOGY.thresholdWindowDays, today) === 'fresh',
  );
  const pick = (f: (t: RideThresholds) => number | null) =>
    aggregate(recent.map((r) => f(r.thresholds!)).filter((v): v is number => v !== null), PHYSIOLOGY.thresholdMinRides);
  return {
    rides: recent.length,
    lt1W: pick((t) => t.lt1W),
    lt1Hr: pick((t) => t.lt1Hr),
    lt2W: pick((t) => t.lt2W),
    lt2Hr: pick((t) => t.lt2Hr),
  };
}
