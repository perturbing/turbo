import { z } from 'zod';

// Reserved recipeId: plans the FTP ramp test (which is a protocol, not a
// recipe — open-ended, run from Training level). Completion is matched against
// ramp-test recordings on that date.
export const RAMP_TEST_RECIPE_ID = 'ramp-test';

// A workout planned on a calendar date. Completion is not stored — it is
// derived from recordings (same recipe, same local date), so plans can never
// disagree with what actually happened.
export const PlannedWorkout = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  recipeId: z.string().min(1),
  // Local calendar date, YYYY-MM-DD (not a timestamp: a plan belongs to a day).
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().optional(),
  createdAt: z.string(),
});
export type PlannedWorkout = z.infer<typeof PlannedWorkout>;
