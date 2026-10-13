import { describe, expect, it } from 'vitest';
import type { RideSample } from '../data/schema';
import { aggregate, cleanRr, dfaAlpha1, dfaWindows, thresholdsFromWindows, type DfaWindow } from './dfa';

// Deterministic pseudo-random numbers so the tests are repeatable.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function gaussian(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

describe('DFA alpha-1', () => {
  it('is about 0.5 for uncorrelated (white-noise) RR intervals', () => {
    const r = rng(1);
    const rr = Array.from({ length: 600 }, () => 0.8 + 0.03 * gaussian(r));
    const a = dfaAlpha1(rr)!;
    expect(a).toBeGreaterThan(0.35);
    expect(a).toBeLessThan(0.65);
  });

  it('is about 1.5 for a random walk (strongly correlated) series', () => {
    const r = rng(2);
    let x = 0.8;
    const rr = Array.from({ length: 600 }, () => (x += 0.002 * gaussian(r)));
    const a = dfaAlpha1(rr)!;
    expect(a).toBeGreaterThan(1.2);
  });

  it('needs enough beats', () => {
    expect(dfaAlpha1(Array(50).fill(0.8))).toBeNull();
  });

  it('corrects ectopic beats and reports the artifact share', () => {
    const rr = Array(100).fill(0.8);
    rr[40] = 0.4; // premature beat
    rr[41] = 1.2; // compensatory pause
    rr[70] = 3; // dropout
    const c = cleanRr(rr);
    expect(c.rr.length).toBe(100);
    expect(Math.max(...c.rr)).toBeLessThanOrEqual(0.8);
    expect(c.artifactPct).toBeCloseTo(3, 6);
  });
});

describe('thresholds from windows', () => {
  // Alpha-1 falling linearly from 1.0 at 100 W to 0.3 at 240 W: LT1 (0.75) at 150 W, LT2 (0.5) at 200 W.
  const linear = (): DfaWindow[] =>
    Array.from({ length: 15 }, (_, i) => {
      const powerW = 100 + i * 10;
      return { startS: i * 10, alpha1: 1.0 - ((powerW - 100) / 140) * 0.7, powerW, hrBpm: 110 + (powerW - 100) * 0.4, artifactPct: 0 };
    });

  it('solves both crossings in power and heart rate', () => {
    const t = thresholdsFromWindows(linear())!;
    expect(t.lt1W).toBeCloseTo(150, 0);
    expect(t.lt2W).toBeCloseTo(200, 0);
    expect(t.lt1Hr).toBeCloseTo(130, 0);
    expect(t.lt2Hr).toBeCloseTo(150, 0);
    expect(t.windows).toBe(15);
  });

  it('refuses to extrapolate: an easy ride that never crosses gives no threshold', () => {
    const easy = linear().filter((w) => w.powerW <= 140); // alpha-1 stays above 0.8
    const t = thresholdsFromWindows(easy)!;
    expect(t.lt1W).toBeNull();
    expect(t.lt2W).toBeNull();
    expect(t.alphaMin).toBeGreaterThan(0.75);
  });

  it('gives LT1 but not LT2 when the ride only reaches tempo', () => {
    const tempo = linear().filter((w) => w.powerW <= 180);
    const t = thresholdsFromWindows(tempo)!;
    expect(t.lt1W).toBeCloseTo(150, 0);
    expect(t.lt2W).toBeNull();
  });

  it('rejects a fit where alpha-1 rises with power', () => {
    const odd = linear().map((w) => ({ ...w, alpha1: 1.3 - w.alpha1 }));
    const t = thresholdsFromWindows(odd)!;
    expect(t.lt1W).toBeNull();
  });
});

describe('windows from samples', () => {
  it('builds 2-minute windows with steady power and clean RR, skipping paused time', () => {
    const r = rng(3);
    const samples: RideSample[] = [];
    for (let t = 1; t <= 600; t++) {
      const hr = 140;
      const beats: number[] = [];
      for (let k = 0; k < hr / 60; k++) beats.push(Math.round((60 / hr + 0.02 * gaussian(r)) * 1000));
      samples.push({ elapsedS: t, ts: '', powerW: 150, cadenceRpm: 90, speedKmh: 30, hrBpm: hr, rrMs: beats });
    }
    const all = dfaWindows(samples);
    expect(all.length).toBeGreaterThan(40);
    expect(all[0].powerW).toBe(150);
    expect(all[0].hrBpm).toBe(140);
    const noneWhilePaused = dfaWindows(samples, (i) => samples[i].elapsedS > 300);
    expect(noneWhilePaused.length).toBeLessThan(all.length / 2 + 2);
  });

  it('drops windows whose power is not steady', () => {
    const r = rng(4);
    const samples: RideSample[] = [];
    for (let t = 1; t <= 300; t++) {
      const beats = [430, 420, 440].map((ms) => ms + Math.round(5 * gaussian(r)));
      samples.push({ elapsedS: t, ts: '', powerW: t % 30 < 15 ? 100 : 300, cadenceRpm: 90, speedKmh: 30, hrBpm: 140, rrMs: beats });
    }
    expect(dfaWindows(samples)).toEqual([]);
  });
});

describe('aggregate', () => {
  it('needs the minimum number of rides and reports quartiles', () => {
    expect(aggregate([200, 210], 3)).toBeNull();
    const a = aggregate([190, 200, 210, 230], 3)!;
    expect(a.median).toBe(205);
    expect(a.rides).toBe(4);
    expect(a.low).toBeLessThan(a.median);
    expect(a.high).toBeGreaterThan(a.median);
  });
});
