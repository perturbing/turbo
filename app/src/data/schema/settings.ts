import { z } from 'zod';

export const Settings = z.object({
  schemaVersion: z.literal(1),
  currentFtpW: z.number().positive().nullable(),
  ftpAcceptedObservationId: z.string().nullable(),
  reducedMotion: z.boolean(),
  // Rider weight for relative VO2max; also what the trainer's SIM physics use.
  weightKg: z.number().positive().nullable().optional(),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  currentFtpW: null,
  ftpAcceptedObservationId: null,
  reducedMotion: false,
  weightKg: null,
};
