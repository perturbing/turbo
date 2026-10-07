import { getDb } from '../db';
import { migrateRecord } from '../migrations';
import { DEFAULT_SETTINGS, Settings } from '../schema';

const KEY = 'app';

export async function loadSettings(): Promise<Settings> {
  const db = await getDb();
  const raw = await db.get('settings', KEY);
  if (!raw) return DEFAULT_SETTINGS;
  return Settings.parse(migrateRecord<Settings>('settings', raw));
}

export async function saveSettings(settings: Settings): Promise<void> {
  const db = await getDb();
  await db.put('settings', Settings.parse(settings), KEY);
}
