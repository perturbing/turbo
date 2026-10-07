import { z } from 'zod';
import { RideMode } from './workout';

// A step of the plan after resolution: repeats expanded, %FTP resolved to watts
// against the FTP snapshot taken at ride start.
export const ResolvedStep = z.object({
  startS: z.number().min(0),
  endS: z.number().positive(),
  kind: z.enum(['steady', 'recovery', 'ramp', 'rampStage', 'cooldown']),
  targetW: z.number().min(0),
  targetEndW: z.number().min(0).optional(), // present for ramps
  cadence: z.object({ minRpm: z.number(), maxRpm: z.number() }).optional(),
  label: z.string().optional(),
});
export type ResolvedStep = z.infer<typeof ResolvedStep>;

export const ResolvedPlan = z.object({
  totalS: z.number().positive(),
  steps: z.array(ResolvedStep).min(1),
});
export type ResolvedPlan = z.infer<typeof ResolvedPlan>;

// One 1 Hz sample. null = source absent or stale at that moment (an explicit
// gap); 0 is a real measured zero. Control commands are recorded as events,
// never samples.
export const RideSample = z.object({
  elapsedS: z.number().min(0),
  ts: z.string(),
  powerW: z.number().nullable(),
  cadenceRpm: z.number().nullable(),
  speedKmh: z.number().nullable(),
  hrBpm: z.number().nullable(),
});
export type RideSample = z.infer<typeof RideSample>;

export const RideEvent = z.object({
  elapsedS: z.number().min(0),
  ts: z.string(),
  type: z.enum([
    'start',
    'pause',
    'resume',
    'deviceDisconnected',
    'deviceReconnected',
    'targetSet',
    'targetFailed',
    'gearChanged',
    'button',
    'stageAdvanced',
    'finish',
  ]),
  detail: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type RideEvent = z.infer<typeof RideEvent>;

export const RecordingState = z.enum([
  'in-progress',
  'completed',
  'ended-early',
  'recovered',
]);
export type RecordingState = z.infer<typeof RecordingState>;

export const RideRecording = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  kind: z.enum(['workout', 'rampTest']),
  recipeId: z.string().optional(),
  recipeRevision: z.number().int().optional(),
  name: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  ftpUsed: z.number().positive().nullable(),
  mode: RideMode,
  resolvedPlan: ResolvedPlan.nullable(), // null for an open-ended ramp test
  state: RecordingState,
  events: z.array(RideEvent),
  summary: z
    .object({
      durationS: z.number(),
      avgPowerW: z.number().nullable(),
      maxPowerW: z.number().nullable(),
      avgCadenceRpm: z.number().nullable(),
      avgHrBpm: z.number().nullable(),
      energyKj: z.number().nullable(),
    })
    .optional(),
});
export type RideRecording = z.infer<typeof RideRecording>;

// Samples are persisted in chunks so autosave appends instead of rewriting.
export const SampleChunk = z.object({
  schemaVersion: z.literal(1),
  recordingId: z.string(),
  chunkIndex: z.number().int().min(0),
  samples: z.array(RideSample),
});
export type SampleChunk = z.infer<typeof SampleChunk>;
