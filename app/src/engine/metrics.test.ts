import { describe, expect, it } from 'vitest';
import type { ResolvedPlan, RideRecording, RideSample } from '../data/schema';
import { computeRideMetrics, normalizedPower, plannedTss, trainingStress } from './metrics';

function recording(over: Partial<RideRecording> = {}): RideRecording {
  return {
    schemaVersion: 1,
    id: 'r1',
    kind: 'workout',
    recipeId: 'endurance',
    name: 'Endurance',
    startedAt: '2026-10-11T06:17:12.623Z',
    ftpUsed: 200,
    mode: 'erg',
    resolvedPlan: null,
    state: 'completed',
    events: [{ elapsedS: 0, ts: '', type: 'start' }],
    ...over,
  };
}

function samples(n: number, f: (t: number) => Partial<RideSample>): RideSample[] {
  return Array.from({ length: n }, (_, i) => ({
    elapsedS: i + 1,
    ts: '',
    powerW: null,
    cadenceRpm: null,
    speedKmh: null,
    hrBpm: null,
    ...f(i + 1),
  }));
}

describe('normalized power and TSS', () => {
  it('equals average power for a steady ride', () => {
    expect(normalizedPower(Array(600).fill(150))).toBeCloseTo(150, 6);
  });

  it('weights hard moments more than easy ones', () => {
    const intervals = [...Array(300).fill(300), ...Array(300).fill(100)];
    const np = normalizedPower(intervals)!;
    expect(np).toBeGreaterThan(200); // average is 200
    expect(np).toBeLessThan(300);
  });

  it('needs at least 30 s', () => {
    expect(normalizedPower(Array(29).fill(100))).toBeNull();
  });

  it('one hour at FTP is 100 TSS', () => {
    expect(trainingStress(3600, 200, 200)).toBeCloseTo(100, 6);
    expect(trainingStress(3600, 120, 200)).toBeCloseTo(36, 6); // 60% FTP
  });
});

describe('computeRideMetrics', () => {
  const plan: ResolvedPlan = {
    totalS: 3600,
    steps: [
      { startS: 0, endS: 600, kind: 'ramp', targetW: 100, targetEndW: 150 },
      { startS: 600, endS: 3600, kind: 'steady', targetW: 150 },
    ],
  };

  it('computes NP, IF, TSS, EF and decoupling for a steady endurance ride', () => {
    // Trainer holds the target; HR drifts from 130 to 140 across the steady block.
    const s = samples(3600, (t) => {
      const target = t < 600 ? 100 + (50 * t) / 600 : 150;
      const hr = t < 600 ? 120 : 130 + (10 * (t - 600)) / 3000;
      return { powerW: Math.round(target), hrBpm: Math.round(hr) };
    });
    const m = computeRideMetrics(recording({ resolvedPlan: plan }), s);
    expect(m.date).toBe('2026-10-11');
    expect(m.movingS).toBe(3600);
    expect(m.normalizedPowerW).toBeGreaterThan(140);
    expect(m.intensityFactor).toBeCloseTo(m.normalizedPowerW! / 200, 6);
    expect(m.tss).toBeCloseTo(100 * m.intensityFactor! ** 2, 3);
    expect(m.efficiencyFactor).toBeCloseTo(m.normalizedPowerW! / m.avgHrBpm!, 6);
    // Same power, HR up ~5 bpm between halves: a few percent of decoupling.
    expect(m.decouplingPct).toBeGreaterThan(2);
    expect(m.decouplingPct).toBeLessThan(5);
    expect(m.compliancePct).toBeGreaterThan(95);
    expect(m.plannedPeakIntensity).toBeCloseTo(0.75, 6);
  });

  it('leaves HR-based metrics null without heart rate and decoupling null without a long steady block', () => {
    const short: ResolvedPlan = { totalS: 600, steps: [{ startS: 0, endS: 600, kind: 'steady', targetW: 150 }] };
    const m = computeRideMetrics(recording({ resolvedPlan: short }), samples(600, () => ({ powerW: 150 })));
    expect(m.avgHrBpm).toBeNull();
    expect(m.efficiencyFactor).toBeNull();
    expect(m.decouplingPct).toBeNull();
    expect(m.tss).toBeCloseTo(100 * 0.75 ** 2 / 6, 3); // 10 min at 75%
  });

  it('compliance ignores paused time and the settle after each step', () => {
    const steps: ResolvedPlan = {
      totalS: 600,
      steps: [
        { startS: 0, endS: 300, kind: 'steady', targetW: 100 },
        { startS: 300, endS: 600, kind: 'steady', targetW: 200 },
      ],
    };
    // Paused 100..200 s of ride time; power sits at 100 W the whole time, so
    // the second step (plan time 300+) is off target.
    const events: RideRecording['events'] = [
      { elapsedS: 0, ts: '', type: 'start' },
      { elapsedS: 100, ts: '', type: 'pause' },
      { elapsedS: 200, ts: '', type: 'resume' },
    ];
    const m = computeRideMetrics(recording({ resolvedPlan: steps, events }), samples(700, () => ({ powerW: 100 })));
    // Riding: 0-100 (step 1), 200-400 (step 1), 400-700 (step 2 at plan 300-600).
    // Step 1 counted: 285 s (minus 15 s settle) all on target; step 2 counted: 285 s all off.
    expect(m.compliancePct).toBeCloseTo(50, 0);
  });

  it('uses the fallback FTP when the recording has none (first ramp test)', () => {
    const m = computeRideMetrics(recording({ kind: 'rampTest', ftpUsed: null, recipeId: undefined }), samples(600, () => ({ powerW: 200 })), 250);
    expect(m.ftpUsed).toBe(250);
    expect(m.intensityFactor).toBeCloseTo(0.8, 6);
  });
});

describe('plannedTss', () => {
  it('matches the TSS of riding the plan exactly', () => {
    const plan: ResolvedPlan = { totalS: 3600, steps: [{ startS: 0, endS: 3600, kind: 'steady', targetW: 200 }] };
    expect(plannedTss(plan, 200)).toBeCloseTo(100, 6);
    const easy: ResolvedPlan = { totalS: 2700, steps: [{ startS: 0, endS: 2700, kind: 'steady', targetW: 120 }] };
    expect(plannedTss(easy, 200)).toBeCloseTo(27, 6);
  });
});
