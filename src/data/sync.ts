// Sync-motor: push udbakken, pull ændringer siden sidste cursor.
// Kører efter hver lokal ændring (debounced), når nettet kommer tilbage,
// når appen får fokus, og periodisk.
import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import type { SyncTable } from '../../shared/records.schema';
import { api, ApiError, OfflineError } from '../lib/api';
import { getToken } from '../lib/token';
import { db, kvGet, kvSet, recordTable, type OutboxRow } from './db';

const TABLES: SyncTable[] = ['workouts', 'set_logs', 'exercise_notes', 'groin_checks', 'mobility_measurements', 'mobility_checks'];
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
  if (!getToken()) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  setState({ phase: 'syncing' });
  try {
    await push();
    await pull();
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
    const changes: Partial<Record<SyncTable, unknown[]>> = {};
    for (const table of TABLES) {
      const uuids = pending.filter((p) => p.table === table).map((p) => p.uuid);
      if (!uuids.length) continue;
      changes[table] = (await recordTable(table).bulkGet(uuids)).filter(Boolean);
    }
    await api('/sync/push', { method: 'POST', json: { changes } });
    await clearSent(pending);
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

async function pull() {
  const since = await kvGet<string>(CURSOR_KEY);
  const res = await api<{ changes: Partial<Record<SyncTable, { uuid: string; updated_at: string }[]>>; cursor: string | null }>(
    `/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ''}`,
  );
  const tables = TABLES.map((t) => recordTable(t));
  await db.transaction('rw', [...tables, db.kv], async () => {
    for (const table of TABLES) {
      const rows = res.changes[table];
      if (!rows?.length) continue;
      const t = recordTable(table);
      const local = await t.bulkGet(rows.map((r) => r.uuid));
      // Last-write-wins: en lokal post der er nyere (eller lige så ny) beholdes.
      const incoming = rows.filter((r, i) => !local[i] || local[i]!.updated_at < r.updated_at);
      if (incoming.length) await t.bulkPut(incoming as never[]);
    }
    if (res.cursor) await kvSet(CURSOR_KEY, res.cursor);
  });
}

let started = false;

/** Starter baggrundssync. Kaldes én gang når appen har et token. */
export function startSync() {
  if (started) return;
  started = true;
  window.addEventListener('online', () => scheduleSync(0));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && scheduleSync(0));
  setInterval(() => scheduleSync(0), 60_000);
  scheduleSync(0);
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
