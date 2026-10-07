import { describe, expect, it } from 'vitest';
import type { WorkoutRecipe } from '../data/schema';
import {
  FtpRequiredError,
  interpolatedTargetW,
  recipeNeedsFtp,
  recipeTotalSeconds,
  resolvePlan,
  targetAt,
} from './planResolve';

const recipe: WorkoutRecipe = {
  schemaVersion: 1,
  id: 'r1',
  revision: 1,
  name: 'Test',
  category: 'intervals',
  defaultMode: 'erg',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  source: 'user',
  blocks: [
    { kind: 'steady', label: 'Warm-up', durationS: 600, target: { basis: 'ftpPct', pct: 50 } },
    {
      kind: 'repeat',
      count: 4,
      blocks: [
        { kind: 'steady', label: 'Effort', durationS: 120, target: { basis: 'ftpPct', pct: 110 } },
        { kind: 'recovery', label: 'Recovery', durationS: 120, target: { basis: 'watts', watts: 100 } },
      ],
    },
    { kind: 'ramp', label: 'Cooldown', durationS: 600, startTarget: { basis: 'ftpPct', pct: 60 }, endTarget: { basis: 'ftpPct', pct: 40 } },
  ],
};

describe('resolvePlan', () => {
  it('expands repeats and matches the doc example total (36 min)', () => {
    expect(recipeTotalSeconds(recipe)).toBe(600 + 4 * 240 + 600);
    const plan = resolvePlan(recipe, 200);
    expect(plan.totalS).toBe(2160);
    expect(plan.steps).toHaveLength(1 + 8 + 1);
  });

  it('resolves %FTP against the snapshot FTP and leaves fixed watts unchanged', () => {
    const plan200 = resolvePlan(recipe, 200);
    const plan210 = resolvePlan(recipe, 210);
    expect(plan200.steps[0].targetW).toBe(100); // 50% of 200
    expect(plan210.steps[0].targetW).toBe(105); // rescaled
    expect(plan200.steps[2].targetW).toBe(100); // fixed 100 W recovery
    expect(plan210.steps[2].targetW).toBe(100); // unchanged by FTP
    expect(plan200.steps[1].targetW).toBe(220); // 110% of 200
  });

  it('steps are contiguous in time', () => {
    const plan = resolvePlan(recipe, 200);
    for (let i = 1; i < plan.steps.length; i++) {
      expect(plan.steps[i].startS).toBe(plan.steps[i - 1].endS);
    }
  });

  it('interpolates ramp targets linearly', () => {
    const plan = resolvePlan(recipe, 200);
    const ramp = plan.steps[plan.steps.length - 1];
    expect(ramp.targetW).toBe(120);
    expect(ramp.targetEndW).toBe(80);
    expect(interpolatedTargetW(ramp, ramp.startS)).toBe(120);
    expect(interpolatedTargetW(ramp, ramp.startS + 300)).toBe(100);
  });

  it('finds the current step by elapsed time', () => {
    const plan = resolvePlan(recipe, 200);
    expect(targetAt(plan, 0)?.label).toBe('Warm-up');
    expect(targetAt(plan, 600)?.label).toBe('Effort 1/4');
    expect(targetAt(plan, 2160)).toBeNull();
  });

  it('throws when FTP is required but missing', () => {
    expect(() => resolvePlan(recipe, null)).toThrow(FtpRequiredError);
    expect(recipeNeedsFtp(recipe)).toBe(true);
  });

  it('resolves fixed-watt-only recipes without FTP', () => {
    const fixed: WorkoutRecipe = {
      ...recipe,
      blocks: [{ kind: 'steady', durationS: 60, target: { basis: 'watts', watts: 150 } }],
    };
    expect(recipeNeedsFtp(fixed)).toBe(false);
    expect(resolvePlan(fixed, null).steps[0].targetW).toBe(150);
  });
});
