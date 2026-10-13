import { describe, expect, it } from 'vitest';
import type { RideSample } from '../data/schema';
import { cpFromAllOut, freshness, rampHrMarkers, thresholdProfile, timeToExhaustionS, vo2maxFromMap } from './physiology';

describe('VO2max from maximal aerobic power', () => {
  it('applies Hawley & Noakes and scales by weight with an error band', () => {
    const v = vo2maxFromMap(300, 75);
    expect(v.litresPerMin).toBeCloseTo(0.01141 * 300 + 0.435, 6); // 3.858
    expect(v.mlPerKgMin).toBeCloseTo(51.44, 1);
    expect(v.low).toBeLessThan(v.mlPerKgMin!);
    expect(v.high).toBeGreaterThan(v.mlPerKgMin!);
  });

  it('gives only absolute VO2max without weight', () => {
    const v = vo2maxFromMap(300, null);
    expect(v.mlPerKgMin).toBeNull();
    expect(v.litresPerMin).toBeGreaterThan(3);
  });
});

describe('freshness', () => {
  it('expires estimates by age', () => {
    expect(freshness('2026-09-01T10:00:00Z', 56, '2026-10-13')).toBe('fresh');
    expect(freshness('2026-08-01T10:00:00Z', 56, '2026-10-13')).toBe('stale');
  });
});

describe('ramp heart-rate markers', () => {
  it('reports HR max and the HR in the minute after power reaches the FTP estimate', () => {
    const samples: RideSample[] = [];
    for (let t = 1; t <= 900; t++) {
      const power = 100 + Math.floor(t / 60) * 20; // ramp stages
      const hr = 110 + t * 0.08; // climbs to ~182
      samples.push({ elapsedS: t, ts: '', powerW: power, cadenceRpm: 90, speedKmh: 30, hrBpm: Math.round(hr) });
    }
    const m = rampHrMarkers(samples, 200); // reached at stage t=300..359
    expect(m.hrMaxBpm).toBe(182);
    expect(m.lthrBpm).toBeGreaterThan(134);
    expect(m.lthrBpm).toBeLessThan(142);
  });
});

describe('3-minute all-out test', () => {
  it('derives CP from the final 30 s and W-prime from the work above it', () => {
    // 500 W falling to 250 W over the first 90 s, then flat at 250 W.
    const power = Array.from({ length: 180 }, (_, t) => (t < 90 ? 500 - (250 * t) / 90 : 250));
    const r = cpFromAllOut(power)!;
    expect(r.cpW).toBeCloseTo(250, 6);
    expect(r.wPrimeJ).toBeCloseTo((r.meanPowerW - 250) * 180, 3);
    expect(r.wPrimeJ).toBeGreaterThan(10_000);
    expect(r.paced).toBe(false);
  });

  it('flags a paced effort and rejects poor coverage', () => {
    const paced = cpFromAllOut(Array(180).fill(280))!;
    expect(paced.paced).toBe(true);
    const gaps = Array(180).fill(300) as (number | null)[];
    for (let i = 0; i < 20; i++) gaps[i * 5] = null;
    expect(cpFromAllOut(gaps)).toBeNull();
  });

  it('time to exhaustion follows the CP/W-prime model', () => {
    expect(timeToExhaustionS(300, 250, 15_000)).toBe(300);
    expect(timeToExhaustionS(240, 250, 15_000)).toBeNull();
  });
});

describe('threshold profile across rides', () => {
  const t = (lt1W: number | null, lt2W: number | null) => ({
    method: 'dfa-a1-v1' as const,
    windows: 20,
    lt1W,
    lt1Hr: lt1W === null ? null : 130,
    lt2W,
    lt2Hr: lt2W === null ? null : 160,
    alphaMin: 0.4,
    alphaMax: 1.0,
  });

  it('pools only recent rides and needs three with a value', () => {
    const rides = [
      { date: '2026-10-10', thresholds: t(150, 200) },
      { date: '2026-10-05', thresholds: t(160, null) },
      { date: '2026-10-01', thresholds: t(155, 205) },
      { date: '2026-08-01', thresholds: t(120, 170) }, // too old
      { date: '2026-10-08', thresholds: null },
    ];
    const p = thresholdProfile(rides, '2026-10-13');
    expect(p.rides).toBe(3);
    expect(p.lt1W!.median).toBe(155);
    expect(p.lt1W!.rides).toBe(3);
    expect(p.lt2W).toBeNull(); // only two rides reached LT2
  });
});
