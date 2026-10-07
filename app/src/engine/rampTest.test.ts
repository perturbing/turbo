import { describe, expect, it } from 'vitest';
import type { RideSample } from '../data/schema';
import { bestRollingWindow, estimateFtp, rampTargetAt, RAMP_V1 } from './rampTest';

function sample(elapsedS: number, powerW: number | null): RideSample {
  return {
    elapsedS,
    ts: new Date(1700000000000 + elapsedS * 1000).toISOString(),
    powerW,
    cadenceRpm: 90,
    speedKmh: null,
    hrBpm: null,
  };
}

describe('rampTargetAt', () => {
  it('holds warm-up power, then steps every stage', () => {
    expect(rampTargetAt(0).targetW).toBe(RAMP_V1.warmupTargetW);
    expect(rampTargetAt(299).targetW).toBe(100);
    expect(rampTargetAt(300)).toEqual({ targetW: 100, stage: 1, stageEndsS: 360 });
    expect(rampTargetAt(360).targetW).toBe(120);
    expect(rampTargetAt(300 + 5 * 60).targetW).toBe(200); // stage 6
  });
});

describe('bestRollingWindow', () => {
  it('finds the best 60 s window, crossing stage boundaries', () => {
    // 0..99 s at 100 W, 100..199 s at 280 W, 200..260 s declining to 0.
    const samples: RideSample[] = [];
    for (let t = 0; t <= 99; t++) samples.push(sample(t, 100));
    for (let t = 100; t <= 199; t++) samples.push(sample(t, 280));
    for (let t = 200; t <= 260; t++) samples.push(sample(t, 0));
    const best = bestRollingWindow(samples);
    expect(best).not.toBeNull();
    expect(best!.avgPowerW).toBeCloseTo(280, 0);
    expect(best!.startElapsedS).toBeGreaterThanOrEqual(100);
    expect(best!.endElapsedS).toBeLessThanOrEqual(200);
  });

  it('a window may not silently span a data gap', () => {
    // High power split by a 10 s dropout: neither half spans 60 s, so no
    // 280 W window must be found.
    const samples: RideSample[] = [];
    for (let t = 0; t <= 40; t++) samples.push(sample(t, 280));
    for (let t = 51; t <= 95; t++) samples.push(sample(t, 280));
    for (let t = 96; t <= 200; t++) samples.push(sample(t, 100));
    const best = bestRollingWindow(samples);
    expect(best).not.toBeNull();
    expect(best!.avgPowerW).toBeLessThan(280);
  });

  it('null power samples are gaps, not zeros', () => {
    const samples: RideSample[] = [];
    for (let t = 0; t <= 40; t++) samples.push(sample(t, 300));
    for (let t = 41; t <= 70; t++) samples.push(sample(t, null));
    for (let t = 71; t <= 131; t++) samples.push(sample(t, 300));
    const best = bestRollingWindow(samples);
    // Only the trailing contiguous 60 s block (71..131) is valid.
    expect(best).not.toBeNull();
    expect(best!.startElapsedS).toBeGreaterThanOrEqual(71);
    expect(best!.avgPowerW).toBeCloseTo(300, 0);
  });

  it('real zeros count toward the average', () => {
    const samples: RideSample[] = [];
    for (let t = 0; t <= 30; t++) samples.push(sample(t, 200));
    for (let t = 31; t <= 60; t++) samples.push(sample(t, 0));
    const best = bestRollingWindow(samples);
    expect(best).not.toBeNull();
    expect(best!.avgPowerW).toBeLessThan(150);
  });

  it('returns null when no valid window exists', () => {
    expect(bestRollingWindow([sample(0, 100), sample(10, 100)])).toBeNull();
    expect(bestRollingWindow([])).toBeNull();
  });

  it('matches the doc example: 280 W best window -> 210 W FTP', () => {
    expect(estimateFtp({ startElapsedS: 0, endElapsedS: 60, avgPowerW: 280 })).toBe(210);
  });
});
