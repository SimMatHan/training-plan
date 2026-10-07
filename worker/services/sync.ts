// Sync mellem klientens IndexedDB og D1.
//   push: klienten sender hele poster; last-write-wins pr. post på updated_at.
//   pull: serveren sender alle poster ændret siden en cursor (server_updated_at).
import { z } from 'zod';
import { IsoTimestamp, SyncTables, type SyncTable } from '../../shared/records.schema';
import { ValidationError } from './errors';

export const TABLES = Object.keys(SyncTables) as SyncTable[];

const BOOLEAN_COLUMNS: Partial<Record<SyncTable, string[]>> = {
  set_logs: ['done'],
  mobility_checks: ['done'],
};

const columnsOf = (table: SyncTable) => Object.keys(SyncTables[table].shape);

export const PushBody = z.object({
  changes: z.partialRecord(z.enum(TABLES as [SyncTable, ...SyncTable[]]), z.array(z.unknown()).max(2000)),
});
export type PushBody = z.infer<typeof PushBody>;

export type SyncRecord = Record<string, unknown> & { uuid: string; updated_at: string };
export type Changes = Partial<Record<SyncTable, SyncRecord[]>>;

const toDb = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : (v ?? null));

/**
 * Gemmer poster. En post overskrives kun hvis den indkomne updated_at er nyere,
 * så gentagne push er idempotente og en gammel enhed ikke overskriver nyere data.
 */
export async function pushChanges(db: D1Database, changes: Partial<Record<SyncTable, unknown[]>>, now = new Date().toISOString()) {
  const statements: D1PreparedStatement[] = [];
  let received = 0;
  for (const table of TABLES) {
    const rows = changes[table];
    if (!rows?.length) continue;
    const schema = SyncTables[table];
    const cols = columnsOf(table);
    const updates = cols.filter((c) => c !== 'uuid').map((c) => `${c} = excluded.${c}`);
    const sql =
      `INSERT INTO ${table} (${cols.join(', ')}, server_updated_at) VALUES (${cols.map(() => '?').join(', ')}, ?) ` +
      `ON CONFLICT (uuid) DO UPDATE SET ${updates.join(', ')}, server_updated_at = excluded.server_updated_at ` +
      `WHERE excluded.updated_at > ${table}.updated_at`;
    for (const raw of rows) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new ValidationError(`Ugyldig post i ${table}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      const row = parsed.data as Record<string, unknown>;
      statements.push(db.prepare(sql).bind(...cols.map((c) => toDb(row[c])), now));
      received++;
    }
  }
  if (statements.length) await db.batch(statements);
  return { received, serverTime: now };
}

/** Hvor langt tilbage cursoren altid holdes, så samtidige skrivninger i samme millisekund ikke tabes. */
const CURSOR_LAG_MS = 2000;

/** Alle poster ændret efter `since` (null = alt). Slettede poster (tombstones) kommer med. */
export async function pullChanges(db: D1Database, since: string | null, now = new Date()) {
  if (since !== null && !IsoTimestamp.safeParse(since).success) throw new ValidationError(`Ugyldig cursor: ${since}`);
  const changes: Changes = {};
  let max = since ?? '';
  for (const table of TABLES) {
    const cols = columnsOf(table);
    const { results } = await db
      .prepare(`SELECT ${cols.join(', ')}, server_updated_at FROM ${table} WHERE server_updated_at > ? ORDER BY server_updated_at`)
      .bind(since ?? '')
      .all<Record<string, unknown>>();
    if (!results.length) continue;
    const bools = BOOLEAN_COLUMNS[table] ?? [];
    changes[table] = results.map(({ server_updated_at, ...row }) => {
      if ((server_updated_at as string) > max) max = server_updated_at as string;
      for (const b of bools) row[b] = row[b] === 1;
      return row as SyncRecord;
    });
  }
  // Nyeste poster hentes igen næste gang (idempotent), så intet tabes på grænsen.
  const lagged = new Date(now.getTime() - CURSOR_LAG_MS).toISOString();
  const cursor = max === '' ? null : max > lagged ? lagged : max;
  return { changes, cursor };
}
