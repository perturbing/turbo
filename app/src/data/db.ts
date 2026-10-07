import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  FtpObservation,
  PlannedWorkout,
  RideRecording,
  SampleChunk,
  Settings,
  WorkoutRecipe,
} from './schema';

export interface BikeDB extends DBSchema {
  recipes: { key: string; value: WorkoutRecipe };
  recordings: {
    key: string;
    value: RideRecording;
    indexes: { byStartedAt: string };
  };
  samples: { key: [string, number]; value: SampleChunk };
  ftpHistory: {
    key: string;
    value: FtpObservation;
    indexes: { byDate: string };
  };
  settings: { key: string; value: Settings };
  plans: {
    key: string;
    value: PlannedWorkout;
    indexes: { byDate: string };
  };
}

// Minimum version. Store creation below is EXISTENCE-based (not version
// arithmetic), and getDb self-heals: if an open database is missing an
// expected store, it bumps the version and runs the upgrade again. This
// recovers from any historical/mixed-version state without data loss.
const DB_VERSION = 2;

const EXPECTED_STORES = ['recipes', 'recordings', 'samples', 'ftpHistory', 'settings', 'plans'] as const;

let dbPromise: Promise<IDBPDatabase<BikeDB>> | null = null;

function openOptions() {
  return {
    upgrade(db: IDBPDatabase<BikeDB>) {
      if (!db.objectStoreNames.contains('recipes')) db.createObjectStore('recipes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('recordings')) {
        const recordings = db.createObjectStore('recordings', { keyPath: 'id' });
        recordings.createIndex('byStartedAt', 'startedAt');
      }
      if (!db.objectStoreNames.contains('samples'))
        db.createObjectStore('samples', { keyPath: ['recordingId', 'chunkIndex'] });
      if (!db.objectStoreNames.contains('ftpHistory')) {
        const ftp = db.createObjectStore('ftpHistory', { keyPath: 'id' });
        ftp.createIndex('byDate', 'date');
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      if (!db.objectStoreNames.contains('plans')) {
        const plans = db.createObjectStore('plans', { keyPath: 'id' });
        plans.createIndex('byDate', 'date');
      }
    },
    // Another open tab runs a NEWER version and wants to upgrade: close this
    // connection so it isn't blocked; the next operation here reopens.
    blocking(_cur: number, _blocked: number | null, event: IDBVersionChangeEvent) {
      (event.target as IDBDatabase | null)?.close();
      dbPromise = null;
    },
    blocked() {
      // An older tab is holding the previous version open; surface it rather
      // than hanging silently.
      console.warn(
        'bike-app: database upgrade is blocked by another open tab of this app. Close other tabs and reload.',
      );
    },
    terminated() {
      dbPromise = null;
    },
  };
}

async function openHealed(): Promise<IDBPDatabase<BikeDB>> {
  let db: IDBPDatabase<BikeDB>;
  try {
    db = await openDB<BikeDB>('bike-app', DB_VERSION, openOptions());
  } catch (e) {
    // Existing database is NEWER than our floor (e.g. healed previously):
    // open at its current version instead.
    if (e instanceof DOMException && e.name === 'VersionError') {
      db = await openDB<BikeDB>('bike-app', undefined, openOptions());
    } else {
      throw e;
    }
  }
  // Self-heal: missing stores -> bump version, upgrade runs, stores created.
  for (let guard = 0; guard < 3; guard++) {
    const missing = EXPECTED_STORES.filter((s) => !db.objectStoreNames.contains(s));
    if (missing.length === 0) return db;
    console.warn(`bike-app: database is missing stores [${missing.join(', ')}]; repairing.`);
    const nextVersion = db.version + 1;
    db.close();
    db = await openDB<BikeDB>('bike-app', nextVersion, openOptions());
  }
  return db;
}

export function getDb(): Promise<IDBPDatabase<BikeDB>> {
  if (!dbPromise) {
    dbPromise = openHealed();
  }
  return dbPromise;
}

// Test hook: reset the cached connection (fake-indexeddb gives a fresh DB per import).
export function resetDbForTests(): void {
  dbPromise = null;
}
