// Lokal database (IndexedDB via Dexie): cache af planen nu, logdata og
// udbakke til sync fra milepæl 3.
import Dexie, { type Table } from 'dexie';

export interface KvRow {
  key: string;
  value: unknown;
}

class LocalDb extends Dexie {
  kv!: Table<KvRow, string>;

  constructor() {
    super('traeningsnav');
    this.version(1).stores({ kv: 'key' });
  }
}

export const db = new LocalDb();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}
