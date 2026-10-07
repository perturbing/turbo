import { migrateRecord, type RecordType } from './migrations';

// Parses a list of stored/imported rows, skipping (and logging) invalid ones
// instead of throwing — one corrupt record must never blank a whole listing.
export function parseAll<T>(
  type: RecordType,
  rows: unknown[],
  schema: { parse(data: unknown): T },
): T[] {
  const out: T[] = [];
  for (const row of rows) {
    try {
      out.push(schema.parse(migrateRecord<T>(type, row)));
    } catch (e) {
      console.warn(`bike-app: skipping invalid ${type} record`, row, e);
    }
  }
  return out;
}
