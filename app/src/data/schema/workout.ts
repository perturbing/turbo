import { z } from 'zod';

// Units throughout the data model: power W, cadence rpm, heart rate bpm,
// speed km/h, durations/elapsed seconds. Absolute timestamps are ISO 8601
// strings (provenance); ride timelines use elapsed seconds.

export const RideMode = z.enum(['erg', 'shift']);
export type RideMode = z.infer<typeof RideMode>;

export const PowerTarget = z.discriminatedUnion('basis', [
  z.object({ basis: z.literal('ftpPct'), pct: z.number().positive() }),
  z.object({ basis: z.literal('watts'), watts: z.number().positive() }),
]);
export type PowerTarget = z.infer<typeof PowerTarget>;

export const CadenceRange = z.object({
  minRpm: z.number().positive(),
  maxRpm: z.number().positive(),
});
export type CadenceRange = z.infer<typeof CadenceRange>;

const blockBase = {
  label: z.string().optional(),
  durationS: z.number().positive(),
  cadence: CadenceRange.optional(),
};

export const SteadyBlock = z.object({
  kind: z.literal('steady'),
  ...blockBase,
  target: PowerTarget,
});

export const RecoveryBlock = z.object({
  kind: z.literal('recovery'),
  ...blockBase,
  target: PowerTarget,
});

export const RampBlock = z.object({
  kind: z.literal('ramp'),
  ...blockBase,
  // Start and end must use the same basis.
  startTarget: PowerTarget,
  endTarget: PowerTarget,
});

export const SimpleBlock = z.discriminatedUnion('kind', [SteadyBlock, RecoveryBlock, RampBlock]);
export type SimpleBlock = z.infer<typeof SimpleBlock>;

// One level of repeat groups (matches the prototype; arbitrary nesting is out of scope).
export const RepeatBlock = z.object({
  kind: z.literal('repeat'),
  label: z.string().optional(),
  count: z.number().int().positive(),
  blocks: z.array(SimpleBlock).min(1),
});
export type RepeatBlock = z.infer<typeof RepeatBlock>;

export const WorkoutBlock = z.union([SimpleBlock, RepeatBlock]);
export type WorkoutBlock = z.infer<typeof WorkoutBlock>;

export const WorkoutRecipe = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  revision: z.number().int().positive(),
  name: z.string().min(1),
  category: z.enum(['endurance', 'intervals', 'tempo', 'recovery', 'test', 'custom']),
  defaultMode: RideMode,
  blocks: z.array(WorkoutBlock).min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  source: z.enum(['builtin', 'user', 'imported']),
});
export type WorkoutRecipe = z.infer<typeof WorkoutRecipe>;
