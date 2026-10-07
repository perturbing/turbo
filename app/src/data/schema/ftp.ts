import { z } from 'zod';

export const FtpObservation = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  // 'ramp-v1' = our named, versioned ramp protocol; 'manual' = rider-entered.
  method: z.enum(['ramp-v1', 'manual']),
  recordingId: z.string().optional(),
  candidateW: z.number().positive(),
  bestWindow: z
    .object({
      startElapsedS: z.number(),
      endElapsedS: z.number(),
      avgPowerW: z.number(),
    })
    .optional(),
  accepted: z.boolean(),
  date: z.string(),
});
export type FtpObservation = z.infer<typeof FtpObservation>;
