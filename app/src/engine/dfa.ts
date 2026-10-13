import type { RideSample } from '../data/schema';

// Heart-rate-variability thresholds from DFA alpha-1.
//
// Detrended fluctuation analysis of the beat-to-beat (RR) series gives a
// short-term scaling exponent alpha-1 that sits near 1.0 at rest, falls as
// intensity rises, and crosses ~0.75 at the first (aerobic) threshold and
// ~0.5 at the second (anaerobic) threshold (Rogers et al., 2021). It needs a
// chest strap with clean RR data and steady 2-minute windows; it works on any
// ride, including ERG. Everything here is pure and unit-tested.

export const DFA_METHOD = 'dfa-a1-v1';

export const DFA = {
  windowS: 120,
  stepS: 10,
  minBeatsPerWindow: 60,
  scales: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  // Artifact detection: an interval off its running median by more than this
  // is replaced by the median; windows with more than maxArtifactPct are dropped.
  artifactDeviation: 0.2,
  maxArtifactPct: 5,
  minRrS: 0.3,
  maxRrS: 2.0,
  // Power must be reasonably steady within a window (std / mean).
  maxPowerCv: 0.15,
  lt1Alpha: 0.75,
  lt2Alpha: 0.5,
  // Regression of alpha-1 on power uses windows in the responsive range.
  fitAlphaMin: 0.35,
  fitAlphaMax: 1.1,
  minFitWindows: 5,
} as const;

// Mark and correct artifacts; returns the cleaned series and the share replaced.
export function cleanRr(rr: number[]): { rr: number[]; artifactPct: number } {
  const out: number[] = [];
  let artifacts = 0;
  const recent: number[] = [];
  for (const x of rr) {
    let value = x;
    const med = recent.length >= 3 ? median(recent) : null;
    const bad = x < DFA.minRrS || x > DFA.maxRrS || (med !== null && Math.abs(x - med) / med > DFA.artifactDeviation);
    if (bad) {
      artifacts++;
      if (med === null) continue; // nothing to replace it with yet
      value = med;
    }
    out.push(value);
    recent.push(value);
    if (recent.length > 7) recent.shift();
  }
  return { rr: out, artifactPct: rr.length ? (artifacts / rr.length) * 100 : 0 };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Short-term DFA scaling exponent (box sizes 4..16) of an RR series.
export function dfaAlpha1(rr: number[], scales: readonly number[] = DFA.scales): number | null {
  const n = rr.length;
  if (n < DFA.minBeatsPerWindow) return null;
  const mean = rr.reduce((a, b) => a + b, 0) / n;
  const y: number[] = new Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += rr[i] - mean;
    y[i] = acc;
  }
  const logN: number[] = [];
  const logF: number[] = [];
  for (const box of scales) {
    const boxes = Math.floor(n / box);
    if (boxes < 2) continue;
    let sumSq = 0;
    for (let b = 0; b < boxes; b++) {
      const start = b * box;
      // Least-squares line through the box.
      let sx = 0,
        sy = 0,
        sxx = 0,
        sxy = 0;
      for (let i = 0; i < box; i++) {
        sx += i;
        sy += y[start + i];
        sxx += i * i;
        sxy += i * y[start + i];
      }
      const slope = (box * sxy - sx * sy) / (box * sxx - sx * sx);
      const intercept = (sy - slope * sx) / box;
      for (let i = 0; i < box; i++) {
        const r = y[start + i] - (intercept + slope * i);
        sumSq += r * r;
      }
    }
    const f = Math.sqrt(sumSq / (boxes * box));
    if (f > 0) {
      logN.push(Math.log(box));
      logF.push(Math.log(f));
    }
  }
  if (logN.length < 3) return null;
  return linearFit(logN, logF).slope;
}

export function linearFit(x: number[], y: number[]): { slope: number; intercept: number } {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0,
    sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) * (x[i] - mx);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

export interface DfaWindow {
  startS: number;
  alpha1: number;
  powerW: number;
  hrBpm: number;
  artifactPct: number;
}

// Sliding 2-minute windows over a ride's RR stream, each with its alpha-1 and
// the mean power / HR over the same seconds. `riding` says which samples were
// taken while the ride was in progress (paused time is excluded).
export function dfaWindows(samples: RideSample[], riding?: (i: number) => boolean): DfaWindow[] {
  const beats: { t: number; rr: number }[] = [];
  const bySecond = new Map<number, RideSample>();
  samples.forEach((s, i) => {
    if (riding && !riding(i)) return;
    bySecond.set(s.elapsedS, s);
    if (!s.rrMs) return;
    let t = s.elapsedS;
    for (const ms of s.rrMs) {
      beats.push({ t, rr: ms / 1000 });
      t += ms / 1000;
    }
  });
  if (beats.length < DFA.minBeatsPerWindow) return [];
  const windows: DfaWindow[] = [];
  const lastT = beats[beats.length - 1].t;
  let lo = 0;
  for (let start = beats[0].t; start + DFA.windowS <= lastT; start += DFA.stepS) {
    while (lo < beats.length && beats[lo].t < start) lo++;
    let hi = lo;
    while (hi < beats.length && beats[hi].t < start + DFA.windowS) hi++;
    const slice = beats.slice(lo, hi);
    if (slice.length < DFA.minBeatsPerWindow) continue;
    const cleaned = cleanRr(slice.map((b) => b.rr));
    if (cleaned.artifactPct > DFA.maxArtifactPct) continue;
    const alpha1 = dfaAlpha1(cleaned.rr);
    if (alpha1 === null) continue;
    const power: number[] = [];
    const hr: number[] = [];
    for (let t = Math.floor(start); t < start + DFA.windowS; t++) {
      const s = bySecond.get(t);
      if (!s) continue;
      if (s.powerW !== null) power.push(s.powerW);
      if (s.hrBpm !== null) hr.push(s.hrBpm);
    }
    if (power.length < DFA.windowS * 0.8 || hr.length < DFA.windowS * 0.8) continue;
    const mp = power.reduce((a, b) => a + b, 0) / power.length;
    const sd = Math.sqrt(power.reduce((a, b) => a + (b - mp) ** 2, 0) / power.length);
    if (mp <= 0 || sd / mp > DFA.maxPowerCv) continue;
    windows.push({ startS: start, alpha1, powerW: mp, hrBpm: hr.reduce((a, b) => a + b, 0) / hr.length, artifactPct: cleaned.artifactPct });
  }
  return windows;
}

export interface RideThresholds {
  method: typeof DFA_METHOD;
  windows: number;
  lt1W: number | null;
  lt1Hr: number | null;
  lt2W: number | null;
  lt2Hr: number | null;
  // Alpha-1 range the ride covered: tells the reader why a threshold is missing.
  alphaMin: number;
  alphaMax: number;
}

// Regress alpha-1 on power (and on HR) across the responsive windows and
// solve for the two crossings. A crossing is reported only when it lies
// inside the range the ride actually covered: never extrapolated.
export function thresholdsFromWindows(windows: DfaWindow[]): RideThresholds | null {
  if (windows.length === 0) return null;
  const fit = windows.filter((w) => w.alpha1 >= DFA.fitAlphaMin && w.alpha1 <= DFA.fitAlphaMax);
  const alphas = windows.map((w) => w.alpha1);
  const base: RideThresholds = {
    method: DFA_METHOD,
    windows: windows.length,
    lt1W: null,
    lt1Hr: null,
    lt2W: null,
    lt2Hr: null,
    alphaMin: Math.min(...alphas),
    alphaMax: Math.max(...alphas),
  };
  if (fit.length < DFA.minFitWindows) return base;
  const solve = (xs: number[], target: number): number | null => {
    const { slope, intercept } = linearFit(xs, fit.map((w) => w.alpha1));
    if (slope >= 0) return null; // alpha-1 must fall with intensity
    const x = (target - intercept) / slope;
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    // Allow a little beyond the covered range (the fit is linear and the
    // crossing is often just past the last steady window), never far.
    const slack = (hi - lo) * 0.1;
    return x >= lo - slack && x <= hi + slack ? x : null;
  };
  const powers = fit.map((w) => w.powerW);
  const hrs = fit.map((w) => w.hrBpm);
  const coversLt1 = base.alphaMin <= DFA.lt1Alpha && base.alphaMax >= DFA.lt1Alpha;
  const coversLt2 = base.alphaMin <= DFA.lt2Alpha && base.alphaMax >= DFA.lt2Alpha;
  return {
    ...base,
    lt1W: coversLt1 ? solve(powers, DFA.lt1Alpha) : null,
    lt1Hr: coversLt1 ? solve(hrs, DFA.lt1Alpha) : null,
    lt2W: coversLt2 ? solve(powers, DFA.lt2Alpha) : null,
    lt2Hr: coversLt2 ? solve(hrs, DFA.lt2Alpha) : null,
  };
}

export function rideThresholds(samples: RideSample[], riding?: (i: number) => boolean): RideThresholds | null {
  return thresholdsFromWindows(dfaWindows(samples, riding));
}

export interface AggregateThreshold {
  median: number;
  low: number; // 25th percentile
  high: number; // 75th percentile
  rides: number;
}

// Median and quartiles across rides; null below `minRides`.
export function aggregate(values: number[], minRides: number): AggregateThreshold | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length < minRides) return null;
  const q = (p: number) => {
    const idx = (xs.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
  };
  return { median: q(0.5), low: q(0.25), high: q(0.75), rides: xs.length };
}
