// Testverden til fase 5: atleten simon (fra migration og seed) og atleten karo, hver med en
// bruger og en session, plus HTTP-hjælpere der kalder Worker'en som appen gør.
import worker, { app } from '../worker/index';
import { createAthleteForUser } from '../worker/services/athletes';
import { createSession } from '../worker/services/users';
import { createSeededD1 } from './d1';

export const ORIGIN = 'https://traeningsnav.test';

export interface Person {
  userId: number;
  athleteId: number;
  slug: string;
  cookie: string;
}

export interface World {
  db: D1Database;
  simon: Person;
  karo: Person;
  env: Record<string, unknown>;
}

/** Et minimalt KV-namespace i hukommelsen (OAuth-tokens i testene). */
export function memoryKv(): KVNamespace {
  const store = new Map<string, { value: string; expires?: number; metadata?: unknown }>();
  const live = (k: string) => {
    const e = store.get(k);
    if (e?.expires && e.expires < Date.now() / 1000) store.delete(k);
    return store.get(k);
  };
  return {
    async get(key: string, type?: unknown) {
      const e = live(key);
      if (!e) return null;
      const t = typeof type === 'string' ? type : (type as { type?: string } | undefined)?.type;
      return t === 'json' ? JSON.parse(e.value) : e.value;
    },
    async getWithMetadata(key: string, type?: unknown) {
      const e = live(key);
      const t = typeof type === 'string' ? type : (type as { type?: string } | undefined)?.type;
      return { value: e ? (t === 'json' ? JSON.parse(e.value) : e.value) : null, metadata: e?.metadata ?? null };
    },
    async put(key: string, value: string, opts?: { expiration?: number; expirationTtl?: number; metadata?: unknown }) {
      const expires = opts?.expiration ?? (opts?.expirationTtl ? Date.now() / 1000 + opts.expirationTtl : undefined);
      store.set(key, { value: typeof value === 'string' ? value : JSON.stringify(value), expires, metadata: opts?.metadata });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(opts?: { prefix?: string; limit?: number; cursor?: string }) {
      const keys = [...store.keys()].filter((k) => live(k) && k.startsWith(opts?.prefix ?? '')).sort();
      return { keys: keys.map((name) => ({ name, metadata: store.get(name)?.metadata })), list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

export async function createWorld(opts: { cleanup?: boolean } = {}): Promise<World> {
  const db = await createSeededD1(opts);
  const simonUser = await db.prepare("SELECT id FROM users WHERE name = 'Simon'").first<number>('id');
  const simonAthlete = await db.prepare("SELECT id FROM athletes WHERE slug = 'simon'").first<number>('id');
  const karoUser = (await db.prepare("INSERT INTO users (name, is_admin, created_at, onboarded_at) VALUES ('Karo', 0, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')").run())
    .meta.last_row_id;
  const karoAthlete = await createAthleteForUser(db, karoUser, 'Karo');
  const cookie = async (userId: number) => `__Host-tn_session=${await createSession(db, userId, 'test')}`;
  return {
    db,
    simon: { userId: simonUser!, athleteId: simonAthlete!, slug: 'simon', cookie: await cookie(simonUser!) },
    karo: { userId: karoUser, athleteId: karoAthlete.id, slug: karoAthlete.slug, cookie: await cookie(karoUser) },
    env: { DB: db, ASSETS: { fetch: async () => new Response('app') }, OAUTH_KV: memoryKv() },
  };
}

/** Kalder /api som appen: session-cookie og Origin = appens domæne. */
export async function call(w: World, who: Person | null, path: string, init: { method?: string; json?: unknown; origin?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (who) headers.Cookie = who.cookie;
  if (init.origin !== null) headers.Origin = init.origin ?? ORIGIN;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(
    `${ORIGIN}${path}`,
    { method: init.method ?? 'GET', headers, ...(init.json !== undefined && { body: JSON.stringify(init.json) }) },
    w.env,
  );
}

/** Kalder hele Worker'en (fx /mcp, /authorize, /cal). */
export function fetchWorker(w: World, path: string, init: RequestInit = {}) {
  return worker.fetch(new Request(path.startsWith('http') ? path : `${ORIGIN}${path}`, init), w.env as never, { waitUntil() {}, passThroughOnException() {} } as never);
}
