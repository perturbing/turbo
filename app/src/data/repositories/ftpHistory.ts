import { getDb } from '../db';
import { parseAll } from '../parseAll';
import { FtpObservation } from '../schema';

export async function listFtpObservations(): Promise<FtpObservation[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('ftpHistory', 'byDate');
  return parseAll('ftpObservation', all, FtpObservation).reverse(); // newest first
}

export async function saveFtpObservation(obs: FtpObservation): Promise<void> {
  const db = await getDb();
  await db.put('ftpHistory', FtpObservation.parse(obs));
}
