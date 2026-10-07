import type { RideSample } from '../data/schema';

// Named, versioned ramp protocol. The method id is stored with every FTP
// observation so a future protocol change never silently reinterprets history.
export const RAMP_METHOD = 'ramp-v1' as const;

export const RAMP_V1 = {
  warmupS: 300,
  warmupTargetW: 100,
  stageStartW: 100,
  stageStepW: 20,
  stageDurationS: 60,
  cooldownTargetW: 100,
  // FTP estimate = multiplier x best rolling 60 s average of measured power.
  estimateMultiplier: 0.75,
  windowS: 60,
  // A window is valid only when sample coverage is contiguous: any inter-sample
  // gap larger than this invalidates windows spanning it. Real zero-power
  // samples count; missing data never silently counts as zero.
  maxGapS: 2,
} as const;

export function rampTargetAt(elapsedS: number): { targetW: number; stage: number; stageEndsS: number } {
  if (elapsedS < RAMP_V1.warmupS) {
    return { targetW: RAMP_V1.warmupTargetW, stage: 0, stageEndsS: RAMP_V1.warmupS };
  }
  const intoRamp = elapsedS - RAMP_V1.warmupS;
  const stage = Math.floor(intoRamp / RAMP_V1.stageDurationS) + 1; // stage 1 = first ramp stage
  return {
    targetW: RAMP_V1.stageStartW + (stage - 1) * RAMP_V1.stageStepW,
    stage,
    stageEndsS: RAMP_V1.warmupS + stage * RAMP_V1.stageDurationS,
  };
}

export interface BestWindow {
  startElapsedS: number;
  endElapsedS: number;
  avgPowerW: number;
}

// Highest rolling 60 s average of MEASURED power, evaluated on timestamps.
// Windows may cross stage boundaries. Samples with null power are gaps: any
// window containing a gap (inter-sample spacing > maxGapS, or missing
// coverage at either edge) is invalid. Returns null when no valid window exists.
export function bestRollingWindow(
  samples: RideSample[],
  windowS: number = RAMP_V1.windowS,
  maxGapS: number = RAMP_V1.maxGapS,
): BestWindow | null {
  const pts = samples
    .filter((s) => s.powerW !== null)
    .map((s) => ({ t: s.elapsedS, p: s.powerW as number }))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;

  let best: BestWindow | null = null;
  let lo = 0;
  for (let hi = 0; hi < pts.length; hi++) {
    while (pts[hi].t - pts[lo].t > windowS) lo++;
    if (pts[hi].t - pts[lo].t < windowS - 1e-9) continue; // not enough span yet
    // Trim lo so the window is exactly <= windowS but spans >= windowS between
    // first and last sample; then check gap contiguity and average via
    // trapezoidal integration over timestamps.
    let valid = true;
    for (let i = lo + 1; i <= hi; i++) {
      if (pts[i].t - pts[i - 1].t > maxGapS) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    let area = 0;
    for (let i = lo + 1; i <= hi; i++) {
      const dt = pts[i].t - pts[i - 1].t;
      area += ((pts[i].p + pts[i - 1].p) / 2) * dt;
    }
    const span = pts[hi].t - pts[lo].t;
    const avg = area / span;
    if (!best || avg > best.avgPowerW) {
      best = { startElapsedS: pts[lo].t, endElapsedS: pts[hi].t, avgPowerW: avg };
    }
  }
  return best;
}

export function estimateFtp(best: BestWindow): number {
  return Math.round(best.avgPowerW * RAMP_V1.estimateMultiplier);
}
