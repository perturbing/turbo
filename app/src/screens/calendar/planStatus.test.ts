import { describe, expect, it } from 'vitest';
import { planMatchesRecording, planStatus, shiftDate } from './CalendarScreen';
import { RAMP_TEST_RECIPE_ID, type PlannedWorkout, type RideRecording } from '../../data/schema';

function plan(recipeId: string, date: string): PlannedWorkout {
  return { schemaVersion: 1, id: 'p1', recipeId, date, createdAt: '2026-10-01T00:00:00.000Z' };
}

function recording(partial: Partial<RideRecording>): RideRecording {
  return {
    schemaVersion: 1,
    id: 'r1',
    kind: 'workout',
    name: 'x',
    startedAt: '2026-10-10T08:00:00.000Z',
    ftpUsed: 200,
    mode: 'erg',
    resolvedPlan: null,
    state: 'completed',
    events: [],
    ...partial,
  };
}

// Note: startedAt is interpreted in local time; use a mid-day UTC time so the
// local date equals 2026-10-10 in any timezone the tests run in.
const midday = '2026-10-10T12:00:00.000Z';

describe('calendar plan status', () => {
  it('matches a workout plan by recipeId', () => {
    const p = plan('recipe-a', '2026-10-10');
    expect(planMatchesRecording(p, recording({ recipeId: 'recipe-a' }))).toBe(true);
    expect(planMatchesRecording(p, recording({ recipeId: 'recipe-b' }))).toBe(false);
  });

  it('a ramp-test plan matches any ramp-test recording', () => {
    const p = plan(RAMP_TEST_RECIPE_ID, '2026-10-10');
    expect(planMatchesRecording(p, recording({ kind: 'rampTest' }))).toBe(true);
    expect(planMatchesRecording(p, recording({ kind: 'workout', recipeId: 'recipe-a' }))).toBe(false);
    expect(
      planStatus(p, [recording({ kind: 'rampTest', startedAt: midday })], '2026-10-12'),
    ).toBe('done');
    expect(
      planStatus(p, [recording({ kind: 'rampTest', startedAt: midday, state: 'ended-early' })], '2026-10-12'),
    ).toBe('partial');
    expect(planStatus(p, [], '2026-10-12')).toBe('missed');
    expect(planStatus(p, [], '2026-10-09')).toBe('planned');
  });

  it('shiftDate moves across month boundaries', () => {
    expect(shiftDate('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDate('2026-11-01', -1)).toBe('2026-10-31');
  });
});
