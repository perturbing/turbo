// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { getDb, resetDbForTests } from './db';
import { commitImport, previewImport, ENVELOPE_FORMAT, ENVELOPE_VERSION } from './exportImport';
import { listPlans } from './repositories/plans';

describe('database self-healing', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetDbForTests();
  });

  it('repairs a v2 database that is missing the plans store', async () => {
    // Reproduce the broken state seen in the field: version says 2, but the
    // plans store was never created (mixed-module/partial-upgrade history).
    const broken = await openDB('bike-app', 2, {
      upgrade(db) {
        db.createObjectStore('recipes', { keyPath: 'id' });
        const recordings = db.createObjectStore('recordings', { keyPath: 'id' });
        recordings.createIndex('byStartedAt', 'startedAt');
        db.createObjectStore('samples', { keyPath: ['recordingId', 'chunkIndex'] });
        const ftp = db.createObjectStore('ftpHistory', { keyPath: 'id' });
        ftp.createIndex('byDate', 'date');
        db.createObjectStore('settings');
        // no plans store!
      },
    });
    broken.close();

    const db = await getDb();
    expect([...db.objectStoreNames]).toContain('plans');
    expect(db.version).toBeGreaterThan(2);

    // The failing flow from the bug report now works end to end.
    const envelope = {
      format: ENVELOPE_FORMAT,
      envelopeVersion: ENVELOPE_VERSION,
      exportedAt: new Date().toISOString(),
      records: {
        recipes: [],
        recordings: [],
        ftpObservations: [],
        plans: [
          {
            schemaVersion: 1,
            id: 'plan-x',
            recipeId: 'some-recipe',
            date: '2026-10-10',
            createdAt: new Date().toISOString(),
          },
        ],
      },
    };
    const preview = await previewImport(JSON.stringify(envelope));
    expect(preview.errors).toEqual([]);
    await commitImport(preview);
    expect(await listPlans()).toHaveLength(1);
  });

  it('opens a database newer than the floor version without error', async () => {
    const newer = await openDB('bike-app', 9, {
      upgrade(db) {
        db.createObjectStore('recipes', { keyPath: 'id' });
        const recordings = db.createObjectStore('recordings', { keyPath: 'id' });
        recordings.createIndex('byStartedAt', 'startedAt');
        db.createObjectStore('samples', { keyPath: ['recordingId', 'chunkIndex'] });
        const ftp = db.createObjectStore('ftpHistory', { keyPath: 'id' });
        ftp.createIndex('byDate', 'date');
        db.createObjectStore('settings');
        const plans = db.createObjectStore('plans', { keyPath: 'id' });
        plans.createIndex('byDate', 'date');
      },
    });
    newer.close();
    const db = await getDb();
    expect(db.version).toBe(9);
    expect([...db.objectStoreNames]).toContain('plans');
  });
});
