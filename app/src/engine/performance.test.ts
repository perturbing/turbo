import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, performanceSeries } from './performance';

describe('performance series', () => {
  it('fitness and fatigue converge toward a constant daily load, form from yesterday', () => {
    const actual = Array.from({ length: 100 }, (_, i) => ({ date: addDays('2026-01-01', i), tss: 50 }));
    const series = performanceSeries(actual, [], '2026-04-10', '2026-04-10');
    const last = series[series.length - 1];
    expect(last.date).toBe('2026-04-10');
    expect(last.fatigue).toBeCloseTo(50, 0);
    expect(last.fitness).toBeGreaterThan(44); // 100 days ≈ 2.4 time constants
    expect(last.fitness).toBeLessThan(50);
    // First day: form is 0 (nothing before), fitness = 50/42.
    expect(series[0].form).toBe(0);
    expect(series[0].fitness).toBeCloseTo(50 / 42, 6);
    // Day 2 form = day 1 fitness - day 1 fatigue (negative after a ride).
    expect(series[1].form).toBeCloseTo(50 / 42 - 50 / 7, 6);
  });

  it('sums several rides on one day and projects planned days after today', () => {
    const actual = [
      { date: '2026-10-01', tss: 30 },
      { date: '2026-10-01', tss: 20 },
      { date: '2026-10-03', tss: 60 },
    ];
    const planned = [
      { date: '2026-10-02', tss: 999 }, // in the past: ignored
      { date: '2026-10-05', tss: 80 },
    ];
    const series = performanceSeries(actual, planned, '2026-10-03', '2026-10-06');
    expect(series.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']);
    expect(series[0].tss).toBe(50);
    expect(series[1].tss).toBe(0);
    expect(series.map((p) => p.projected)).toEqual([false, false, false, true, true, true]);
    expect(series[4].tss).toBe(80);
    expect(series[3].tss).toBe(0);
  });

  it('is empty without any load', () => {
    expect(performanceSeries([], [], '2026-10-03', '2026-10-06')).toEqual([
      expect.objectContaining({ date: '2026-10-03', tss: 0 }),
      expect.objectContaining({ date: '2026-10-04' }),
      expect.objectContaining({ date: '2026-10-05' }),
      expect.objectContaining({ date: '2026-10-06' }),
    ]);
  });

  it('date helpers work across month ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(daysBetween('2026-10-01', '2026-10-13')).toBe(12);
  });
});
