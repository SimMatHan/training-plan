// Alle skrivninger går herigennem: først IndexedDB + udbakke i én transaktion,
// derefter sync i baggrunden. Intet går tabt hvis appen lukkes.
// Læs-flet-skriv sker inde i transaktionen; IndexedDB kører overlappende
// skrivetransaktioner i rækkefølge, så to hurtige ændringer af samme post
// (fx kg og derefter ✓) ikke overskriver hinanden.
import type { SyncTable, Workout } from '../../shared/records.schema';
import { ownSlug } from '../lib/auth';
import { db, recordTable, type RecordTypes } from './db';
import { scheduleSync } from './sync';

/** Tidsstempel der altid er nyere end `prev`, også ved to ændringer i samme millisekund. */
export function nextTimestamp(prev?: string | null): string {
  const after = prev ? Date.parse(prev) + 1 : 0;
  return new Date(Math.max(Date.now(), after)).toISOString();
}

type Draft<T extends SyncTable> = Omit<RecordTypes[T], 'updated_at' | 'deleted_at'> & { deleted_at?: string | null };

/** Opretter eller retter en post: `build` får den nuværende post (eller undefined) og returnerer den nye. */
export async function writeRecord<T extends SyncTable>(
  table: T,
  uuid: string,
  build: (prev: RecordTypes[T] | undefined) => Draft<T>,
): Promise<RecordTypes[T]> {
  const t = recordTable(table);
  // Alt der logges på telefonen, hører til brugerens egen atlet.
  const athleteSlug = ownSlug();
  if (!athleteSlug) throw new Error('Ingen egen atlet: log ind igen');
  let saved!: RecordTypes[T];
  await db.transaction('rw', t, db.outbox, async () => {
    const prev = await t.get(uuid);
    const updated_at = nextTimestamp(prev?.updated_at);
    saved = { deleted_at: null, ...build(prev), uuid, updated_at } as RecordTypes[T];
    await t.put(saved);
    await db.outbox.put({ key: `${table}:${uuid}`, table, uuid, athleteSlug, queuedAt: updated_at });
  });
  scheduleSync();
  return saved;
}

export const saveRecord = <T extends SyncTable>(table: T, draft: Draft<T>) => writeRecord(table, draft.uuid, () => draft);

/** Opretter posten med `defaults` hvis den ikke findes, og lægger `patch` ovenpå. */
export const upsertRecord = <T extends SyncTable>(table: T, uuid: string, defaults: Draft<T>, patch: Partial<RecordTypes[T]>) =>
  writeRecord(table, uuid, (prev) => ({ ...(prev ?? defaults), ...patch, uuid }) as Draft<T>);

export async function patchRecord<T extends SyncTable>(table: T, uuid: string, patch: Partial<RecordTypes[T]>): Promise<void> {
  await writeRecord(table, uuid, (prev) => {
    if (!prev) throw new Error(`${table}/${uuid} findes ikke lokalt`);
    return { ...prev, ...patch, uuid } as Draft<T>;
  });
}

/** Sletning er en tombstone, så den også synker. */
export const deleteRecord = (table: SyncTable, uuid: string) => patchRecord(table, uuid, { deleted_at: new Date().toISOString() });

export const newUuid = () => crypto.randomUUID();

export function emptyWorkout(fields: Pick<Workout, 'date' | 'type'> & Partial<Workout>): Draft<'workouts'> {
  return {
    uuid: newUuid(),
    planned_session_id: null,
    plan_version: null,
    week_no: null,
    started_at: new Date().toISOString(),
    finished_at: null,
    rpe: null,
    note: null,
    source: 'app',
    external_id: null,
    distance_km: null,
    duration_sec: null,
    avg_hr: null,
    activity: null,
    skipped_at: null,
    skip_reason: null,
    ...fields,
  };
}
