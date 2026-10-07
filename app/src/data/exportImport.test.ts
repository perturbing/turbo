// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { resetDbForTests } from './db';
import { seedBuiltinWorkouts, BUILTIN_WORKOUTS } from './builtinWorkouts';
import { listRecipes } from './repositories/recipes';
import { saveRecording, saveSampleChunk, loadSamples, listRecordings } from './repositories/recordings';
import { saveFtpObservation, listFtpObservations } from './repositories/ftpHistory';
import { savePlan, listPlans } from './repositories/plans';
import { loadSettings, saveSettings } from './repositories/settings';
import { DEFAULT_SETTINGS } from './schema';
import {
  commitImport,
  exportAll,
  exportRecording,
  ImportFormatError,
  previewImport,
  recordingToCsv,
} from './exportImport';
import type { RideRecording, RideSample } from './schema';

function freshDb() {
  // New IDBFactory = clean database, as a new browser profile would have.
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
}

const recording: RideRecording = {
  schemaVersion: 1,
  id: 'rec-1',
  kind: 'workout',
  recipeId: 'builtin-intervals-4x2',
  recipeRevision: 1,
  name: '4 x 2 min Efforts',
  startedAt: '2026-10-01T10:00:00.000Z',
  endedAt: '2026-10-01T10:36:00.000Z',
  ftpUsed: 200,
  mode: 'erg',
  resolvedPlan: {
    totalS: 120,
    steps: [{ startS: 0, endS: 120, kind: 'steady', targetW: 110, label: 'Warm-up' }],
  },
  state: 'completed',
  events: [
    { elapsedS: 0, ts: '2026-10-01T10:00:00.000Z', type: 'start' },
    { elapsedS: 0, ts: '2026-10-01T10:00:01.000Z', type: 'targetSet', detail: { targetW: 110 } },
  ],
  summary: { durationS: 120, avgPowerW: 108, maxPowerW: 115, avgCadenceRpm: 90, avgHrBpm: null, energyKj: 13 },
};

const samples: RideSample[] = Array.from({ length: 120 }, (_, i) => ({
  elapsedS: i,
  ts: new Date(Date.parse(recording.startedAt) + i * 1000).toISOString(),
  powerW: i < 5 ? null : 108, // leading gap stays explicit
  cadenceRpm: 90,
  speedKmh: 32.5,
  hrBpm: null,
}));

async function populate() {
  await seedBuiltinWorkouts();
  await saveRecording(recording);
  await saveSampleChunk({ schemaVersion: 1, recordingId: 'rec-1', chunkIndex: 0, samples: samples.slice(0, 60) });
  await saveSampleChunk({ schemaVersion: 1, recordingId: 'rec-1', chunkIndex: 1, samples: samples.slice(60) });
  await saveFtpObservation({
    schemaVersion: 1,
    id: 'ftp-1',
    method: 'ramp-v1',
    recordingId: 'rec-1',
    candidateW: 210,
    bestWindow: { startElapsedS: 500, endElapsedS: 560, avgPowerW: 280 },
    accepted: true,
    date: '2026-10-01T10:40:00.000Z',
  });
  await savePlan({
    schemaVersion: 1,
    id: 'plan-1',
    recipeId: 'builtin-intervals-4x2',
    date: '2026-10-08',
    note: 'morning session',
    createdAt: '2026-10-01T10:45:00.000Z',
  });
  await saveSettings({ ...DEFAULT_SETTINGS, currentFtpW: 210, ftpAcceptedObservationId: 'ftp-1' });
}

describe('export -> import round-trip into a clean installation', () => {
  beforeEach(freshDb);

  it('seeds builtin workouts once, idempotently', async () => {
    await seedBuiltinWorkouts();
    await seedBuiltinWorkouts();
    const recipes = await listRecipes();
    expect(recipes).toHaveLength(BUILTIN_WORKOUTS.length);
  });

  it('round-trips every record type without loss', async () => {
    await populate();
    const envelope = await exportAll();
    const json = JSON.stringify(envelope);

    freshDb(); // simulate a brand-new device
    const preview = await previewImport(json);
    expect(preview.errors).toEqual([]);
    expect(preview.recipes.filter((r) => r.action === 'add')).toHaveLength(BUILTIN_WORKOUTS.length);
    expect(preview.recordings[0].action).toBe('add');
    expect(preview.ftpObservations[0].action).toBe('add');
    expect(preview.plans[0].action).toBe('add');

    await commitImport(preview);
    const recipes = await listRecipes();
    const recordings = await listRecordings();
    const ftp = await listFtpObservations();
    const plans = await listPlans();
    expect(recipes).toHaveLength(BUILTIN_WORKOUTS.length);
    expect(recordings).toHaveLength(1);
    expect(recordings[0]).toEqual(recording);
    expect(ftp).toHaveLength(1);
    expect(plans).toHaveLength(1);
    expect(plans[0].date).toBe('2026-10-08');
    // Current FTP travels with Export all and is restored on a fresh install.
    expect(preview.ftpToApply?.currentFtpW).toBe(210);
    const settings = await loadSettings();
    expect(settings.currentFtpW).toBe(210);
    expect(settings.ftpAcceptedObservationId).toBe('ftp-1');
    const restored = await loadSamples('rec-1');
    expect(restored).toEqual(samples);
    expect(restored[0].powerW).toBeNull(); // explicit gap survives
  });

  it('a single ramp-ride export carries its FTP observation and restores FTP', async () => {
    await populate();
    const envelope = await exportRecording('rec-1');
    expect(envelope).not.toBeNull();
    expect(envelope!.records.ftpObservations).toHaveLength(1);
    expect(envelope!.settings).toBeUndefined(); // per-ride export has no settings

    freshDb();
    const preview = await previewImport(JSON.stringify(envelope));
    expect(preview.errors).toEqual([]);
    // No settings in the file -> FTP inferred from the accepted observation.
    expect(preview.ftpToApply).toEqual(
      expect.objectContaining({ currentFtpW: 210, ftpAcceptedObservationId: 'ftp-1' }),
    );
    await commitImport(preview);
    expect((await loadSettings()).currentFtpW).toBe(210);
    expect(await listFtpObservations()).toHaveLength(1);
  });

  it('never overrides a locally set FTP on import', async () => {
    await populate();
    const json = JSON.stringify(await exportAll());
    freshDb();
    await saveSettings({ ...DEFAULT_SETTINGS, currentFtpW: 250, ftpAcceptedObservationId: null });
    const preview = await previewImport(json);
    expect(preview.ftpToApply).toBeNull();
    await commitImport(preview);
    expect((await loadSettings()).currentFtpW).toBe(250);
  });

  it('skips duplicates on re-import', async () => {
    await populate();
    const json = JSON.stringify(await exportAll());
    const preview = await previewImport(json);
    expect(preview.recordings[0].action).toBe('skip');
    expect(preview.recipes.every((r) => r.action === 'skip')).toBe(true);
    const { added } = await commitImport(preview);
    expect(added).toBe(0);
  });

  it('imports a conflicting recipe revision as a copy', async () => {
    await populate();
    const envelope = await exportAll();
    const recipeRecord = envelope.records.recipes[0] as { revision: number; id: string };
    recipeRecord.revision = 2;
    const preview = await previewImport(JSON.stringify(envelope));
    const conflicted = preview.recipes.find((r) => r.record.id === recipeRecord.id);
    expect(conflicted?.action).toBe('copy');
    await commitImport(preview);
    const recipes = await listRecipes();
    expect(recipes.length).toBe(BUILTIN_WORKOUTS.length + 1);
  });

  it('rejects invalid JSON and foreign files with readable errors', async () => {
    await expect(previewImport('not json')).rejects.toThrow(ImportFormatError);
    await expect(previewImport('{"something":"else"}')).rejects.toThrow(/not a bike-app-export/);
  });

  it('rejects newer envelope versions explicitly', async () => {
    const future = {
      format: 'bike-app-export',
      envelopeVersion: 99,
      exportedAt: new Date().toISOString(),
      records: { recipes: [], recordings: [], ftpObservations: [] },
    };
    await expect(previewImport(JSON.stringify(future))).rejects.toThrow(/envelope version 99/);
  });

  it('reports invalid records without aborting the rest', async () => {
    await populate();
    const envelope = await exportAll();
    envelope.records.recipes.push({ id: 'broken', schemaVersion: 1 });
    const preview = await previewImport(JSON.stringify(envelope));
    expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0]).toContain('broken');
  });

  it('exports CSV with explicit empty cells for gaps', () => {
    const csv = recordingToCsv(samples.slice(0, 6));
    const lines = csv.split('\n');
    expect(lines[0]).toBe('elapsed_s,timestamp,power_w,cadence_rpm,speed_kmh,hr_bpm');
    expect(lines[1]).toContain(',,90,32.5,'); // null power -> empty cell
    expect(lines[6].split(',')[2]).toBe('108');
  });
});
