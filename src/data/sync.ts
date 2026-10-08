// Sync-motor: push udbakken, pull ændringer siden sidste cursor — for brugerens egen atlet.
// Kører efter hver lokal ændring (debounced), når nettet kommer tilbage, når appen får fokus,
// og periodisk. Uden gyldig session venter udbakken, til der er logget ind igen.
import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import type { SyncTable } from '../../shared/records.schema';
import { SYNC_TABLES } from '../../shared/tables';
import { api, ApiError, athleteApi, OfflineError } from '../lib/api';
import { getAuth, ownSlug } from '../lib/auth';
import { db, kvGet, kvSet, recordTable, type OutboxRow } from './db';

const TABLES: readonly SyncTable[] = SYNC_TABLES;
const CURSOR_KEY = 'syncCursor';
const PUSH_BATCH = 500;

export interface SyncState {
  phase: 'idle' | 'syncing' | 'offline' | 'error';
  lastSyncAt?: string;
  error?: string;
}

let state: SyncState = { phase: 'idle' };
const listeners = new Set<() => void>();
const setState = (s: Partial<SyncState>) => {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
};

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;

export function scheduleSync(delayMs = 800) {
  clearTimeout(timer);
  timer = setTimeout(() => void runSync(), delayMs);
}

export async function runSync(): Promise<void> {
  const slug = ownSlug();
  if (getAuth().status !== 'in' || !slug || !db) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  setState({ phase: 'syncing' });
  try {
    await push();
    await pull(slug);
    setState({ phase: 'idle', lastSyncAt: new Date().toISOString(), error: undefined });
  } catch (e) {
    if (e instanceof OfflineError) setState({ phase: 'offline' });
    else setState({ phase: 'error', error: e instanceof ApiError ? e.message : String(e) });
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleSync(0);
    }
  }
}

async function push() {
  for (;;) {
    const pending = await db.outbox.orderBy('queuedAt').limit(PUSH_BATCH).toArray();
    if (!pending.length) return;
    // Posterne sendes til den atlet, de blev logget for.
    for (const slug of new Set(pending.map((p) => p.athleteSlug))) {
      const group = pending.filter((p) => p.athleteSlug === slug);
      const changes: Partial<Record<SyncTable, unknown[]>> = {};
      for (const table of TABLES) {
        const uuids = group.filter((p) => p.table === table).map((p) => p.uuid);
        if (!uuids.length) continue;
        changes[table] = (await recordTable(table).bulkGet(uuids)).filter(Boolean);
      }
      await athleteApi(slug, '/sync/push', { method: 'POST', json: { changes } });
      await clearSent(group);
    }
    if (pending.length < PUSH_BATCH) return;
  }
}

/** Fjerner kun rækker der ikke er ændret igen mens push kørte. */
async function clearSent(sent: OutboxRow[]) {
  await db.transaction('rw', db.outbox, async () => {
    for (const s of sent) {
      const current = await db.outbox.get(s.key);
      if (current?.queuedAt === s.queuedAt) await db.outbox.delete(s.key);
    }
  });
}

async function pull(slug: string) {
  const since = await kvGet<string>(CURSOR_KEY);
  const res = await athleteApi<{ changes: Partial<Record<SyncTable, { uuid: string; updated_at: string }[]>>; cursor: string | null }>(
    slug,
    `/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ''}`,
  );
  const tables = TABLES.map((t) => recordTable(t));
  await db.transaction('rw', [...tables, db.kv], async () => {
    for (const table of TABLES) {
      const rows = res.changes[table];
      if (!rows?.length) continue;
      const t = recordTable(table);
      const local = (await t.bulkGet(rows.map((r) => r.uuid))) as ({ updated_at: string } | undefined)[];
      // Last-write-wins: en lokal post der er nyere (eller lige så ny) beholdes.
      const incoming = rows.filter((r, i) => !local[i] || local[i]!.updated_at < r.updated_at);
      if (incoming.length) await t.bulkPut(incoming as never[]);
    }
    if (res.cursor) await kvSet(CURSOR_KEY, res.cursor);
  });
}

let interval: ReturnType<typeof setInterval> | undefined;
const onOnline = () => scheduleSync(0);
const onVisible = () => document.visibilityState === 'visible' && scheduleSync(0);

/** Starter baggrundssync. Kaldes når brugeren er logget ind og databasen er åben. */
export function startSync() {
  if (interval) return scheduleSync(0);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  interval = setInterval(() => scheduleSync(0), 60_000);
  scheduleSync(0);
}

/** Stopper sync (ved log ud). */
export function stopSync() {
  clearInterval(interval);
  clearTimeout(timer);
  interval = undefined;
  window.removeEventListener('online', onOnline);
  document.removeEventListener('visibilitychange', onVisible);
  setState({ phase: 'idle', lastSyncAt: undefined, error: undefined });
}

/** Logger ud: sletter sessionen på serveren og den lokale database på enheden. */
export async function logout(): Promise<void> {
  stopSync();
  try {
    await api('/auth/logout', { method: 'POST', anonymous: true });
  } catch {
    // Offline: cookien udløber af sig selv; den lokale database slettes alligevel.
  }
}

/** pending er undefined indtil udbakken er læst. */
export function useSyncState(): SyncState & { pending: number | undefined } {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
  const pending = useLiveQuery(() => db.outbox.count(), []);
  return { ...s, pending };
}
