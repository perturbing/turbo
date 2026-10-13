import type { WorkoutRecipe } from './schema';
import { getDb } from './db';

const T = '2026-01-01T00:00:00.000Z';

// Fixed UUIDs so re-seeding and import dedupe are self-healing.
const base = { schemaVersion: 1 as const, revision: 1, createdAt: T, updatedAt: T, source: 'builtin' as const };

// Reserved: the 3-minute all-out critical-power test. Ridden in Shift mode
// (ERG cannot hold an all-out effort); the analysis finds the all-out step by
// this id and derives CP and W' from it (engine/physiology.ts).
export const CP_TEST_RECIPE_ID = 'builtin-cp-test-3min';

export const BUILTIN_WORKOUTS: WorkoutRecipe[] = [
  {
    ...base,
    id: CP_TEST_RECIPE_ID,
    name: '3-minute all-out test (Shift mode)',
    category: 'test',
    defaultMode: 'shift',
    blocks: [
      { kind: 'ramp', label: 'Warm-up', durationS: 600, startTarget: { basis: 'ftpPct', pct: 45 }, endTarget: { basis: 'ftpPct', pct: 65 } },
      { kind: 'steady', label: 'Opener', durationS: 20, target: { basis: 'ftpPct', pct: 120 }, cadence: { minRpm: 95, maxRpm: 110 } },
      { kind: 'recovery', label: 'Settle', durationS: 220, target: { basis: 'ftpPct', pct: 50 } },
      { kind: 'steady', label: 'ALL OUT — no pacing', durationS: 180, target: { basis: 'ftpPct', pct: 150 }, cadence: { minRpm: 90, maxRpm: 110 } },
      { kind: 'recovery', label: 'Cooldown', durationS: 600, target: { basis: 'ftpPct', pct: 45 } },
    ],
  },
  {
    ...base,
    id: 'builtin-endurance-220',
    name: 'Long Endurance',
    category: 'endurance',
    defaultMode: 'erg',
    blocks: [
      { kind: 'steady', label: 'Warm-up', durationS: 600, target: { basis: 'ftpPct', pct: 50 } },
      { kind: 'steady', label: 'Endurance', durationS: 7200, target: { basis: 'ftpPct', pct: 60 } },
      { kind: 'recovery', label: 'Cooldown', durationS: 600, target: { basis: 'ftpPct', pct: 50 } },
    ],
  },
  {
    ...base,
    id: 'builtin-intervals-4x2',
    name: '4 x 2 min Efforts',
    category: 'intervals',
    defaultMode: 'erg',
    blocks: [
      { kind: 'steady', label: 'Warm-up', durationS: 600, target: { basis: 'ftpPct', pct: 50 } },
      {
        kind: 'repeat',
        label: 'Efforts',
        count: 4,
        blocks: [
          { kind: 'steady', label: 'Effort', durationS: 120, target: { basis: 'ftpPct', pct: 110 }, cadence: { minRpm: 90, maxRpm: 105 } },
          { kind: 'recovery', label: 'Recovery', durationS: 120, target: { basis: 'ftpPct', pct: 50 } },
        ],
      },
      { kind: 'recovery', label: 'Cooldown', durationS: 600, target: { basis: 'ftpPct', pct: 50 } },
    ],
  },
  {
    ...base,
    id: 'builtin-tempo-3x10',
    name: 'Tempo 3 x 10 min',
    category: 'tempo',
    defaultMode: 'erg',
    blocks: [
      { kind: 'steady', label: 'Warm-up', durationS: 600, target: { basis: 'ftpPct', pct: 50 } },
      {
        kind: 'repeat',
        label: 'Tempo blocks',
        count: 3,
        blocks: [
          { kind: 'steady', label: 'Tempo', durationS: 600, target: { basis: 'ftpPct', pct: 85 }, cadence: { minRpm: 85, maxRpm: 95 } },
          { kind: 'recovery', label: 'Float', durationS: 300, target: { basis: 'ftpPct', pct: 55 } },
        ],
      },
      { kind: 'recovery', label: 'Cooldown', durationS: 600, target: { basis: 'ftpPct', pct: 50 } },
    ],
  },
  {
    ...base,
    id: 'builtin-sweetspot-ramps',
    name: 'Sweet Spot Ramps',
    category: 'tempo',
    defaultMode: 'erg',
    blocks: [
      { kind: 'ramp', label: 'Ramp up', durationS: 600, startTarget: { basis: 'ftpPct', pct: 45 }, endTarget: { basis: 'ftpPct', pct: 75 } },
      {
        kind: 'repeat',
        label: 'Sweet spot',
        count: 2,
        blocks: [
          { kind: 'ramp', label: 'Build', durationS: 480, startTarget: { basis: 'ftpPct', pct: 84 }, endTarget: { basis: 'ftpPct', pct: 94 } },
          { kind: 'recovery', label: 'Recovery', durationS: 240, target: { basis: 'ftpPct', pct: 55 } },
        ],
      },
      { kind: 'ramp', label: 'Cooldown', durationS: 480, startTarget: { basis: 'ftpPct', pct: 60 }, endTarget: { basis: 'ftpPct', pct: 40 } },
    ],
  },
  {
    ...base,
    id: 'builtin-recovery-45',
    name: 'Recovery Spin',
    category: 'recovery',
    defaultMode: 'erg',
    blocks: [
      { kind: 'steady', label: 'Easy spin', durationS: 2400, target: { basis: 'ftpPct', pct: 45 }, cadence: { minRpm: 85, maxRpm: 100 } },
      { kind: 'recovery', label: 'Cooldown', durationS: 300, target: { basis: 'ftpPct', pct: 40 } },
    ],
  },
  {
    ...base,
    id: 'builtin-shift-free-60',
    name: 'Free Ride (Shift)',
    category: 'endurance',
    defaultMode: 'shift',
    blocks: [
      { kind: 'steady', label: 'Warm-up', durationS: 600, target: { basis: 'ftpPct', pct: 50 } },
      { kind: 'steady', label: 'Ride', durationS: 2400, target: { basis: 'ftpPct', pct: 65 } },
      { kind: 'recovery', label: 'Cooldown', durationS: 600, target: { basis: 'ftpPct', pct: 45 } },
    ],
  },
];

// Seed on first launch; existing (possibly user-modified) entries are kept.
export async function seedBuiltinWorkouts(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('recipes', 'readwrite');
  for (const recipe of BUILTIN_WORKOUTS) {
    const existing = await tx.store.get(recipe.id);
    if (!existing) await tx.store.put(recipe);
  }
  await tx.done;
}
