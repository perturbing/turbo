import { describe, expect, it } from 'vitest';
import type { RideMetrics } from './metrics';
import { addDays, performanceSeries, type DailyLoad } from './performance';
import { assessForm, RULES, type RideForVerdict } from './verdict';

const TODAY = '2026-11-15';

function metrics(over: Partial<RideMetrics>): RideMetrics {
  return {
    version: 'metrics-v3',
    recordingId: 'x',
    date: TODAY,
    ftpUsed: 200,
    movingS: 3600,
    avgPowerW: 140,
    normalizedPowerW: 145,
    intensityFactor: 0.72,
    tss: 52,
    avgHrBpm: 135,
    maxHrBpm: 158,
    efficiencyFactor: 1.07,
    decouplingPct: 3,
    compliancePct: 95,
    plannedPeakIntensity: 0.75,
    thresholds: null,
    cpTest: null,
    ...over,
  };
}

function ride(daysAgo: number, over: Partial<RideForVerdict> = {}, m: Partial<RideMetrics> = {}): RideForVerdict {
  return {
    metrics: metrics({ date: addDays(TODAY, -daysAgo), recordingId: `r${daysAgo}`, ...m }),
    recipeId: 'endurance',
    state: 'completed',
    deviceFailure: false,
    ...over,
  };
}

// A steady schedule: an endurance ride every other day for `weeks` weeks.
function schedule(weeks: number, tss = 52): { rides: RideForVerdict[]; loads: DailyLoad[] } {
  const rides: RideForVerdict[] = [];
  for (let d = weeks * 7; d >= 0; d -= 2) rides.push(ride(d, {}, { tss }));
  return { rides, loads: rides.map((r) => ({ date: r.metrics.date, tss })) };
}

describe('form verdict (form-v1)', () => {
  it('needs enough history before it says anything', () => {
    const { rides, loads } = schedule(1);
    const series = performanceSeries(loads, [], TODAY, TODAY);
    const v = assessForm(series, TODAY, rides);
    expect(v.verdict).toBe('insufficient');
    expect(v.reasons[0]).toContain(`${RULES.minRides} rides`);
  });

  it('says load when fatigue is productive and the body is absorbing', () => {
    const { rides, loads } = schedule(6);
    const series = performanceSeries(loads, [], TODAY, TODAY);
    const v = assessForm(series, TODAY, rides);
    expect(v.verdict).toBe('load');
    expect(v.facts.form).toBeLessThan(0);
    expect(v.reasons.some((r) => r.includes('being absorbed'))).toBe(true);
  });

  it('says hold when fitness is ramping too fast', () => {
    // Six easy weeks, then a brutal week.
    const { rides, loads } = schedule(6, 30);
    const hard = [1, 2, 3, 4, 5, 6].map((d) => ride(d, { recipeId: 'hard' }, { tss: 150, plannedPeakIntensity: 0.7 }));
    const series = performanceSeries([...loads, ...hard.map((r) => ({ date: r.metrics.date, tss: 150 }))], [], TODAY, TODAY);
    const v = assessForm(series, TODAY, [...rides, ...hard]);
    expect(v.facts.fitnessRampPerWeek).toBeGreaterThan(RULES.maxFitnessRampPerWeek);
    expect(['hold', 'rest']).toContain(v.verdict);
    expect(v.reasons.some((r) => r.includes('Fitness rose'))).toBe(true);
  });

  it('says rest when form is deeply negative', () => {
    const { rides, loads } = schedule(6, 20);
    const week = [1, 2, 3, 4, 5, 6, 7].map((d) => ride(d, { recipeId: 'smash' }, { tss: 250, plannedPeakIntensity: 0.7 }));
    const series = performanceSeries([...loads, ...week.map((r) => ({ date: r.metrics.date, tss: 250 }))], [], TODAY, TODAY);
    const v = assessForm(series, TODAY, [...rides, ...week]);
    expect(v.facts.form).toBeLessThan(RULES.overreachedBelow);
    expect(v.verdict).toBe('rest');
  });

  it('flags a falling efficiency factor and a rising effort rating as not absorbing', () => {
    const { rides, loads } = schedule(6);
    // Same workout repeated: EF 1.10, 1.10, 1.10 then 1.00 (-9 %); RPE 5,5,5,5 then 8,8.
    const efs = [1.1, 1.1, 1.1, 1.0];
    const rpes = [5, 5, 5, 5, 8, 8];
    const marked = rides.map((r, i) => ({
      ...r,
      effortRating: rpes[Math.max(0, i - (rides.length - rpes.length))],
      metrics: { ...r.metrics, efficiencyFactor: efs[Math.max(0, i - (rides.length - efs.length))] },
    }));
    const series = performanceSeries(loads, [], TODAY, TODAY);
    const v = assessForm(series, TODAY, marked);
    expect(v.verdict).toBe('rest');
    expect(v.reasons.some((r) => r.includes('Efficiency') && r.includes('fell'))).toBe(true);
    expect(v.reasons.some((r) => r.includes('felt harder'))).toBe(true);
  });

  it('a single flag means hold, and device failures do not count against key sessions', () => {
    const { rides, loads } = schedule(6);
    const key = [
      ride(3, { recipeId: 'sst', state: 'ended-early', deviceFailure: true }, { plannedPeakIntensity: 0.9 }),
      ride(1, { recipeId: 'sst', state: 'ended-early' }, { plannedPeakIntensity: 0.9, compliancePct: 60 }),
    ];
    const series = performanceSeries(loads, [], TODAY, TODAY);
    const v = assessForm(series, TODAY, [...rides, ...key]);
    // Only one genuine key-session failure (the other was the device) -> no flag.
    expect(v.verdict).toBe('load');
    const both = [...key, ride(5, { recipeId: 'sst', state: 'ended-early' }, { plannedPeakIntensity: 0.9 })];
    const v2 = assessForm(series, TODAY, [...rides, ...both]);
    expect(v2.verdict).toBe('hold');
    expect(v2.reasons.some((r) => r.includes('last two hard sessions'))).toBe(true);
  });

  it('reports test readiness when a ramp test is planned', () => {
    const { rides, loads } = schedule(6);
    const series = performanceSeries(loads, [], TODAY, TODAY);
    const v = assessForm(series, TODAY, rides, 3);
    expect(v.testReady).toBe(false); // form is negative on a steady schedule
    expect(v.reasons.at(-1)).toContain('maximal test is planned within 3 days');
  });
});
