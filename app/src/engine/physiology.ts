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
  // 3-minute all-out test (Vanhatalo et al., 2007): CP = mean power of the
  // final 30 s, W' = work done above CP over the 180 s.
  allOutDurationS: 180,
  allOutEndWindowS: 30,
  // An all-out start that is not much above the end was paced.
  pacedIfEndOverStart: 0.85,
  minAllOutCoverage: 0.95,
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

export interface CpTestResult {
  method: 'all-out-3min-v1';
  cpW: number;
  wPrimeJ: number;
  meanPowerW: number;
  startPowerW: number; // first 30 s
  paced: boolean;
  coverage: number; // share of the 180 s with a power reading
}

// Power samples of the all-out step, in order, one per second (nulls = gaps).
export function cpFromAllOut(power: (number | null)[]): CpTestResult | null {
  const dur = PHYSIOLOGY.allOutDurationS;
  const have = power.slice(0, dur).filter((p): p is number => p !== null);
  const coverage = have.length / dur;
  if (coverage < PHYSIOLOGY.minAllOutCoverage) return null;
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((p): p is number => p !== null);
    return v.reduce((a, b) => a + b, 0) / v.length;
  };
  const end = power.slice(dur - PHYSIOLOGY.allOutEndWindowS, dur);
  const start = power.slice(0, PHYSIOLOGY.allOutEndWindowS);
  const cpW = mean(end);
  const meanPowerW = mean(power.slice(0, dur));
  const startPowerW = mean(start);
  return {
    method: 'all-out-3min-v1',
    cpW,
    wPrimeJ: Math.max(0, (meanPowerW - cpW) * dur),
    meanPowerW,
    startPowerW,
    paced: cpW / startPowerW > PHYSIOLOGY.pacedIfEndOverStart,
    coverage,
  };
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
