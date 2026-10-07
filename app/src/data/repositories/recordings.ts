import { getDb } from '../db';
import { migrateRecord } from '../migrations';
import { parseAll } from '../parseAll';
import { RideRecording, RideSample, SampleChunk } from '../schema';

export async function listRecordings(): Promise<RideRecording[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('recordings', 'byStartedAt');
  return parseAll('recording', all, RideRecording).reverse(); // newest first
}

export async function getRecording(id: string): Promise<RideRecording | undefined> {
  const db = await getDb();
  const raw = await db.get('recordings', id);
  return raw ? RideRecording.parse(migrateRecord<RideRecording>('recording', raw)) : undefined;
}

export async function saveRecording(recording: RideRecording): Promise<void> {
  const db = await getDb();
  await db.put('recordings', RideRecording.parse(recording));
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['recordings', 'samples'], 'readwrite');
  await tx.objectStore('recordings').delete(id);
  const range = IDBKeyRange.bound([id, 0], [id, Infinity]);
  let cursor = await tx.objectStore('samples').openCursor(range);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function saveSampleChunk(chunk: SampleChunk): Promise<void> {
  const db = await getDb();
  await db.put('samples', SampleChunk.parse(chunk));
}

export async function loadSamples(recordingId: string): Promise<RideSample[]> {
  const db = await getDb();
  const range = IDBKeyRange.bound([recordingId, 0], [recordingId, Infinity]);
  const chunks = await db.getAll('samples', range);
  return parseAll('sampleChunk', chunks, SampleChunk)
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .flatMap((c) => c.samples);
}

// Crash recovery: any recording still marked in-progress at app launch.
export async function findInProgressRecordings(): Promise<RideRecording[]> {
  const all = await listRecordings();
  return all.filter((r) => r.state === 'in-progress');
}
