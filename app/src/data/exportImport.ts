import { z } from 'zod';
import { getDb } from './db';
import { migrateRecord, UnsupportedVersionError } from './migrations';
import {
  FtpObservation,
  PlannedWorkout,
  RideRecording,
  RideSample,
  SampleChunk,
  Settings,
  WorkoutRecipe,
} from './schema';
import { listRecipes } from './repositories/recipes';
import { listRecordings, loadSamples } from './repositories/recordings';
import { listFtpObservations } from './repositories/ftpHistory';
import { listPlans } from './repositories/plans';
import { loadSettings, saveSettings } from './repositories/settings';

export const ENVELOPE_FORMAT = 'bike-app-export';
export const ENVELOPE_VERSION = 1;

// A recording travels with its samples inlined so one file is a complete record.
const ExportedRecording = RideRecording.extend({ samples: z.array(RideSample) });
type ExportedRecording = z.infer<typeof ExportedRecording>;

export const ExportEnvelope = z.object({
  format: z.literal(ENVELOPE_FORMAT),
  envelopeVersion: z.number().int().positive(),
  exportedAt: z.string(),
  records: z.object({
    recipes: z.array(z.unknown()).default([]),
    recordings: z.array(z.unknown()).default([]),
    ftpObservations: z.array(z.unknown()).default([]),
    // Added later; defaulted so pre-calendar exports stay importable.
    plans: z.array(z.unknown()).default([]),
  }),
  // Current FTP + preferences; optional so older exports stay importable.
  settings: z.unknown().optional(),
});
export type ExportEnvelope = z.infer<typeof ExportEnvelope>;

function makeEnvelope(records: ExportEnvelope['records'], settings?: Settings): ExportEnvelope {
  return {
    format: ENVELOPE_FORMAT,
    envelopeVersion: ENVELOPE_VERSION,
    exportedAt: new Date().toISOString(),
    records,
    ...(settings ? { settings } : {}),
  };
}

export async function exportAll(): Promise<ExportEnvelope> {
  const [recipes, recordings, ftpObservations, plans, settings] = await Promise.all([
    listRecipes(),
    listRecordings(),
    listFtpObservations(),
    listPlans(),
    loadSettings(),
  ]);
  const withSamples: ExportedRecording[] = [];
  for (const rec of recordings) {
    withSamples.push({ ...rec, samples: await loadSamples(rec.id) });
  }
  return makeEnvelope({ recipes, recordings: withSamples, ftpObservations, plans }, settings);
}

export async function exportRecording(id: string): Promise<ExportEnvelope | null> {
  const recordings = await listRecordings();
  const rec = recordings.find((r) => r.id === id);
  if (!rec) return null;
  const samples = await loadSamples(id);
  // A ramp-test ride travels with the FTP observation(s) derived from it, so
  // importing it elsewhere restores the Training level history too.
  const ftpObservations = (await listFtpObservations()).filter((o) => o.recordingId === id);
  return makeEnvelope({ recipes: [], recordings: [{ ...rec, samples }], ftpObservations, plans: [] });
}

export function exportRecipe(recipe: WorkoutRecipe): ExportEnvelope {
  return makeEnvelope({ recipes: [recipe], recordings: [], ftpObservations: [], plans: [] });
}

export interface ImportItem<T> {
  record: T;
  samples?: RideSample[];
  // skip: identical id already present; copy: same id, different content -> import under new id
  action: 'add' | 'skip' | 'copy';
  reason?: string;
}

export interface ImportPreview {
  recipes: ImportItem<WorkoutRecipe>[];
  recordings: ImportItem<RideRecording>[];
  ftpObservations: ImportItem<FtpObservation>[];
  plans: ImportItem<PlannedWorkout>[];
  // Restores current FTP when none is set locally: from the export's settings,
  // or inferred from the newest accepted imported observation. Never overrides
  // an FTP the local installation already has.
  ftpToApply: { currentFtpW: number; ftpAcceptedObservationId: string | null; source: string } | null;
  errors: string[];
}

export class ImportFormatError extends Error {}

// Parse + validate + migrate + diff against the current DB. Throws
// ImportFormatError / UnsupportedVersionError with user-readable messages.
export async function previewImport(json: string): Promise<ImportPreview> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ImportFormatError('The file is not valid JSON.');
  }
  const env = ExportEnvelope.safeParse(parsed);
  if (!env.success) {
    throw new ImportFormatError(
      `The file is not a ${ENVELOPE_FORMAT} file (missing or invalid envelope fields).`,
    );
  }
  if (env.data.envelopeVersion > ENVELOPE_VERSION) {
    throw new ImportFormatError(
      `This export uses envelope version ${env.data.envelopeVersion}; this app understands up to ${ENVELOPE_VERSION}. Update the app to import it.`,
    );
  }

  const preview: ImportPreview = {
    recipes: [],
    recordings: [],
    ftpObservations: [],
    plans: [],
    ftpToApply: null,
    errors: [],
  };
  // Each existing listing is best-effort: a store that cannot be read (e.g. a
  // database mid-upgrade) degrades duplicate detection, it must not abort the
  // whole import preview.
  const safe = async <T,>(p: Promise<T[]>): Promise<T[]> => {
    try {
      return await p;
    } catch (e) {
      console.warn('bike-app: could not list existing records during import preview', e);
      return [];
    }
  };
  const [existingRecipes, existingRecordings, existingFtp, existingPlans] = await Promise.all([
    safe(listRecipes()),
    safe(listRecordings()),
    safe(listFtpObservations()),
    safe(listPlans()),
  ]);

  for (const raw of env.data.records.recipes) {
    try {
      const rec = WorkoutRecipe.parse(migrateRecord<WorkoutRecipe>('recipe', raw));
      const existing = existingRecipes.find((r) => r.id === rec.id);
      if (!existing) preview.recipes.push({ record: rec, action: 'add' });
      else if (existing.revision === rec.revision)
        preview.recipes.push({ record: rec, action: 'skip', reason: 'already present' });
      else preview.recipes.push({ record: rec, action: 'copy', reason: 'same id, different revision' });
    } catch (e) {
      preview.errors.push(describeRecordError('workout', raw, e));
    }
  }

  for (const raw of env.data.records.recordings) {
    try {
      const { samples, ...rest } = raw as { samples?: unknown };
      const rec = RideRecording.parse(migrateRecord<RideRecording>('recording', rest));
      const parsedSamples = z.array(RideSample).parse(samples ?? []);
      const existing = existingRecordings.find((r) => r.id === rec.id);
      if (!existing) preview.recordings.push({ record: rec, samples: parsedSamples, action: 'add' });
      else preview.recordings.push({ record: rec, samples: parsedSamples, action: 'skip', reason: 'already present' });
    } catch (e) {
      preview.errors.push(describeRecordError('recording', raw, e));
    }
  }

  for (const raw of env.data.records.ftpObservations) {
    try {
      const obs = FtpObservation.parse(migrateRecord<FtpObservation>('ftpObservation', raw));
      const existing = existingFtp.find((o) => o.id === obs.id);
      if (!existing) preview.ftpObservations.push({ record: obs, action: 'add' });
      else preview.ftpObservations.push({ record: obs, action: 'skip', reason: 'already present' });
    } catch (e) {
      preview.errors.push(describeRecordError('FTP observation', raw, e));
    }
  }

  for (const raw of env.data.records.plans) {
    try {
      const plan = PlannedWorkout.parse(migrateRecord<PlannedWorkout>('plan', raw));
      const existing = existingPlans.find((p) => p.id === plan.id);
      if (!existing) preview.plans.push({ record: plan, action: 'add' });
      else preview.plans.push({ record: plan, action: 'skip', reason: 'already present' });
    } catch (e) {
      preview.errors.push(describeRecordError('planned workout', raw, e));
    }
  }

  // Current-FTP restore (device replacement): only when the local install has
  // no FTP yet. Prefer the export's settings; fall back to the newest accepted
  // observation in the file (covers single-ramp-ride exports and old files).
  const localSettings = await loadSettings().catch(() => null);
  if (localSettings && localSettings.currentFtpW === null) {
    if (env.data.settings !== undefined) {
      try {
        const s = Settings.parse(migrateRecord<Settings>('settings', env.data.settings));
        if (s.currentFtpW !== null) {
          preview.ftpToApply = {
            currentFtpW: s.currentFtpW,
            ftpAcceptedObservationId: s.ftpAcceptedObservationId,
            source: 'export settings',
          };
        }
      } catch (e) {
        preview.errors.push(describeRecordError('settings', env.data.settings, e));
      }
    }
    if (!preview.ftpToApply) {
      const newestAccepted = preview.ftpObservations
        .map((i) => i.record)
        .filter((o) => o.accepted)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (newestAccepted) {
        preview.ftpToApply = {
          currentFtpW: newestAccepted.candidateW,
          ftpAcceptedObservationId: newestAccepted.id,
          source: `accepted ${newestAccepted.method} result of ${new Date(newestAccepted.date).toLocaleDateString()}`,
        };
      }
    }
  }

  return preview;
}

function describeRecordError(kind: string, raw: unknown, e: unknown): string {
  const id = typeof raw === 'object' && raw && 'id' in raw ? ` "${(raw as { id: unknown }).id}"` : '';
  if (e instanceof UnsupportedVersionError) return `${kind}${id}: ${e.message}`;
  return `${kind}${id}: invalid record, skipped.`;
}

const SAMPLES_PER_CHUNK = 60;

export async function commitImport(preview: ImportPreview): Promise<{ added: number }> {
  const db = await getDb();
  let added = 0;
  const tx = db.transaction(['recipes', 'recordings', 'samples', 'ftpHistory', 'plans'], 'readwrite');

  for (const item of preview.recipes) {
    if (item.action === 'skip') continue;
    const record =
      item.action === 'copy'
        ? { ...item.record, id: crypto.randomUUID(), name: `${item.record.name} (imported copy)`, source: 'imported' as const }
        : item.record;
    await tx.objectStore('recipes').put(record);
    added++;
  }

  for (const item of preview.recordings) {
    if (item.action === 'skip') continue;
    await tx.objectStore('recordings').put(item.record);
    const samples = item.samples ?? [];
    for (let i = 0; i * SAMPLES_PER_CHUNK < samples.length; i++) {
      const chunk: SampleChunk = {
        schemaVersion: 1,
        recordingId: item.record.id,
        chunkIndex: i,
        samples: samples.slice(i * SAMPLES_PER_CHUNK, (i + 1) * SAMPLES_PER_CHUNK),
      };
      await tx.objectStore('samples').put(chunk);
    }
    added++;
  }

  for (const item of preview.ftpObservations) {
    if (item.action === 'skip') continue;
    await tx.objectStore('ftpHistory').put(item.record);
    added++;
  }

  for (const item of preview.plans) {
    if (item.action === 'skip') continue;
    await tx.objectStore('plans').put(item.record);
    added++;
  }

  await tx.done;

  if (preview.ftpToApply) {
    const settings = await loadSettings();
    if (settings.currentFtpW === null) {
      await saveSettings({
        ...settings,
        currentFtpW: preview.ftpToApply.currentFtpW,
        ftpAcceptedObservationId: preview.ftpToApply.ftpAcceptedObservationId,
      });
    }
  }
  return { added };
}

export function recordingToCsv(samples: RideSample[]): string {
  const header = 'elapsed_s,timestamp,power_w,cadence_rpm,speed_kmh,hr_bpm';
  const rows = samples.map((s) =>
    [s.elapsedS, s.ts, s.powerW ?? '', s.cadenceRpm ?? '', s.speedKmh ?? '', s.hrBpm ?? ''].join(','),
  );
  return [header, ...rows].join('\n');
}

export function downloadFile(filename: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
