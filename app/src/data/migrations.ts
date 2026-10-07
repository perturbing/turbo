// Per-record-type migration chains. Each record carries a `schemaVersion`;
// when a stored or imported record is older than CURRENT, it is passed through
// the chain v -> v+1 -> … until current. This keeps every historical export
// importable forever. IndexedDB store *shape* changes are handled separately
// in db.ts's upgrade callback.

export type RecordType = 'recipe' | 'recording' | 'sampleChunk' | 'ftpObservation' | 'settings' | 'plan';

export const CURRENT_VERSION: Record<RecordType, number> = {
  recipe: 1,
  recording: 1,
  sampleChunk: 1,
  ftpObservation: 1,
  settings: 1,
  plan: 1,
};

type Migration = (record: Record<string, unknown>) => Record<string, unknown>;

// migrations[type][v] upgrades a record from version v to v+1.
const migrations: Record<RecordType, Record<number, Migration>> = {
  recipe: {},
  recording: {},
  sampleChunk: {},
  ftpObservation: {},
  settings: {},
  plan: {},
};

export class UnsupportedVersionError extends Error {
  constructor(
    public readonly recordType: RecordType,
    public readonly foundVersion: number,
  ) {
    super(
      `This ${recordType} uses schema version ${foundVersion}, but this app only understands up to version ${CURRENT_VERSION[recordType]}. Update the app to import it.`,
    );
  }
}

export function migrateRecord<T>(type: RecordType, raw: unknown): T {
  let record = raw as Record<string, unknown>;
  let version = typeof record?.schemaVersion === 'number' ? record.schemaVersion : 1;
  const target = CURRENT_VERSION[type];
  if (version > target) throw new UnsupportedVersionError(type, version);
  while (version < target) {
    const step = migrations[type][version];
    if (!step) throw new UnsupportedVersionError(type, version);
    record = step(record);
    version = record.schemaVersion as number;
  }
  return record as T;
}
