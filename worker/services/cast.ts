// Cast til TV: telefonen opretter en cast-session med rutinen og sender sin tilstand (spiller/pause og hvor
// langt), når den ændres. TV'et henter tilstanden med et hemmeligt token (eller slår det op med en kode på
// seks cifre) og regner selv nedtællingen ud fra serverens ur, så kun ændringer skal over nettet.
import { z } from 'zod';
import { YogaRoutine } from '../../shared/plan.schema';
import { ConflictError, NotFoundError } from './errors';

/** En cast lever så længe (forlænges ved hver opdatering fra telefonen). */
export const CAST_TTL_MS = 3 * 3600_000;

export const CastState = z.object({
  playing: z.boolean(),
  elapsedMs: z.number().min(0).max(24 * 3600_000),
  /** Om TV'et spiller lydene. */
  tvSound: z.boolean().default(true),
});
export type CastState = z.infer<typeof CastState>;

export const CastCreate = z.object({
  title: z.string().trim().min(1).max(120),
  routine: YogaRoutine,
  state: CastState,
});

export interface CastView {
  title: string;
  routine: YogaRoutine;
  state: CastState;
  /** Serverens tidspunkt (ms) hvor state.elapsedMs gjaldt. */
  stateAt: number;
  serverNow: number;
  tvSeenAt: number | null;
  ended: boolean;
}

interface Row {
  token: string;
  code: string;
  athlete_id: number;
  title: string;
  routine_json: string;
  state_json: string;
  state_at: string;
  tv_seen_at: string | null;
  expires_at: string;
  ended_at: string | null;
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

function randomCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

const view = (r: Row, now: Date): CastView => ({
  title: r.title,
  routine: JSON.parse(r.routine_json),
  state: JSON.parse(r.state_json),
  stateAt: Date.parse(r.state_at),
  serverNow: now.getTime(),
  tvSeenAt: r.tv_seen_at ? Date.parse(r.tv_seen_at) : null,
  ended: !!r.ended_at || r.expires_at <= now.toISOString(),
});

export async function createCast(db: D1Database, athleteId: number, input: unknown, now = new Date()) {
  const { title, routine, state } = CastCreate.parse(input);
  const iso = now.toISOString();
  await db.prepare('DELETE FROM cast_sessions WHERE expires_at < ?').bind(iso).run();
  const token = hex(crypto.getRandomValues(new Uint8Array(16)));
  const expires = new Date(now.getTime() + CAST_TTL_MS).toISOString();
  // Koden skal være unik blandt de levende casts; prøv igen ved sammenfald.
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    try {
      await db
        .prepare(
          'INSERT INTO cast_sessions (token, code, athlete_id, title, routine_json, state_json, state_at, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(token, code, athleteId, title, JSON.stringify(routine), JSON.stringify(state), iso, iso, expires)
        .run();
      return { token, code, expiresAt: expires, serverNow: now.getTime() };
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e;
    }
  }
  throw new ConflictError('Kunne ikke lave en ledig kode. Prøv igen.');
}

async function own(db: D1Database, athleteId: number, token: string): Promise<Row> {
  const row = await db.prepare('SELECT * FROM cast_sessions WHERE token = ? AND athlete_id = ?').bind(token, athleteId).first<Row>();
  if (!row) throw new NotFoundError('Cast findes ikke');
  return row;
}

/** Telefonens nye tilstand. Svarer med serverens ur og hvornår TV'et sidst hentede. */
export async function updateCast(db: D1Database, athleteId: number, token: string, input: unknown, now = new Date()) {
  const state = CastState.parse(input);
  const row = await own(db, athleteId, token);
  if (row.ended_at) throw new ConflictError('Cast er afsluttet');
  const iso = now.toISOString();
  await db
    .prepare('UPDATE cast_sessions SET state_json = ?, state_at = ?, expires_at = ? WHERE token = ? AND athlete_id = ?')
    .bind(JSON.stringify(state), iso, new Date(now.getTime() + CAST_TTL_MS).toISOString(), token, athleteId)
    .run();
  return { serverNow: now.getTime(), tvSeenAt: row.tv_seen_at ? Date.parse(row.tv_seen_at) : null };
}

export async function endCast(db: D1Database, athleteId: number, token: string, now = new Date()) {
  await own(db, athleteId, token);
  await db.prepare('UPDATE cast_sessions SET ended_at = ? WHERE token = ? AND athlete_id = ?').bind(now.toISOString(), token, athleteId).run();
}

/** TV'et: tilstanden for et token. Noterer højst hvert 10. sekund, at TV'et er der. */
export async function readCast(db: D1Database, token: string, now = new Date()): Promise<CastView> {
  if (!/^[0-9a-f]{32}$/.test(token)) throw new NotFoundError('Cast findes ikke');
  const row = await db.prepare('SELECT * FROM cast_sessions WHERE token = ?').bind(token).first<Row>();
  if (!row || (row.expires_at <= now.toISOString() && !row.ended_at)) throw new NotFoundError('Cast findes ikke eller er udløbet');
  if (!row.tv_seen_at || now.getTime() - Date.parse(row.tv_seen_at) > 10_000) {
    row.tv_seen_at = now.toISOString();
    await db.prepare('UPDATE cast_sessions SET tv_seen_at = ? WHERE token = ?').bind(row.tv_seen_at, token).run();
  }
  return view(row, now);
}

/** Koden på seks cifre → token, for en levende cast. */
export async function tokenForCode(db: D1Database, code: string, now = new Date()): Promise<string | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const row = await db
    .prepare('SELECT token FROM cast_sessions WHERE code = ? AND ended_at IS NULL AND expires_at > ?')
    .bind(code, now.toISOString())
    .first<{ token: string }>();
  return row?.token ?? null;
}
