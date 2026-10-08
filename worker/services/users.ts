// Brugere, passkeys, sessioner, invitationer og WebAuthn-udfordringer i D1.
// Session-id'er og invitationstokens gemmes kun som SHA-256; selve værdierne findes kun i
// cookien og i linket.
import type { PasskeyInfo, UserInfo } from '../../shared/athletes';
import { randomToken, sha256Hex } from '../crypto';
import { listAthletesForUser } from './athletes';
import { ConflictError, NotFoundError, ValidationError } from './errors';

export interface SessionUser {
  id: number;
  name: string;
  isAdmin: boolean;
  onboarded: boolean;
}

interface UserRow {
  id: number;
  name: string;
  is_admin: number;
  onboarded_at: string | null;
}

const toUser = (r: UserRow): SessionUser => ({ id: r.id, name: r.name, isAdmin: r.is_admin === 1, onboarded: !!r.onboarded_at });

export const SESSION_TTL_MS = 90 * 86_400_000;
/** Udløbet forlænges ved brug, men højst én skrivning pr. døgn. */
const SESSION_TOUCH_MS = 86_400_000;
export const INVITE_TTL_MS = 7 * 86_400_000;
const CHALLENGE_TTL_MS = 5 * 60_000;

const iso = (ms: number) => new Date(ms).toISOString();

export async function getUser(db: D1Database, id: number): Promise<SessionUser | null> {
  const r = await db.prepare('SELECT id, name, is_admin, onboarded_at FROM users WHERE id = ?').bind(id).first<UserRow>();
  return r ? toUser(r) : null;
}

// ─── Sessioner ──────────────────────────────────────────────────────────────

/** Ny session. Returnerer session-id'et (32 tilfældige bytes) til cookien; D1 får kun hashen. */
export async function createSession(db: D1Database, userId: number, userAgent: string | null, now = Date.now()): Promise<string> {
  const id = randomToken(32);
  await db
    .prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256Hex(id), userId, iso(now), iso(now + SESSION_TTL_MS), iso(now), userAgent?.slice(0, 200) ?? null)
    .run();
  return id;
}

/** Brugeren bag en gyldig session. Forlænger udløbet, hvis sessionen sidst blev set for over et døgn siden. */
export async function getSessionUser(db: D1Database, sessionId: string, now = Date.now()): Promise<SessionUser | null> {
  const hash = await sha256Hex(sessionId);
  const row = await db
    .prepare(
      'SELECT u.id, u.name, u.is_admin, u.onboarded_at, s.expires_at, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?',
    )
    .bind(hash)
    .first<UserRow & { expires_at: string; last_seen_at: string }>();
  if (!row) return null;
  if (Date.parse(row.expires_at) <= now) {
    await db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(hash).run();
    return null;
  }
  if (now - Date.parse(row.last_seen_at) > SESSION_TOUCH_MS)
    await db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?').bind(iso(now), iso(now + SESSION_TTL_MS), hash).run();
  return toUser(row);
}

export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256Hex(sessionId)).run();
}

// ─── Passkeys ───────────────────────────────────────────────────────────────

export interface StoredPasskey {
  id: number;
  user_id: number;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
}

export async function findPasskey(db: D1Database, credentialId: string): Promise<StoredPasskey | null> {
  return db.prepare('SELECT id, user_id, credential_id, public_key, counter, transports FROM passkeys WHERE credential_id = ?').bind(credentialId).first<StoredPasskey>();
}

export async function userCredentialIds(db: D1Database, userId: number): Promise<{ id: string; transports?: string[] }[]> {
  const { results } = await db.prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ?').bind(userId).all<{ credential_id: string; transports: string | null }>();
  return results.map((r) => ({ id: r.credential_id, ...(r.transports && { transports: JSON.parse(r.transports) as string[] }) }));
}

export async function addPasskey(
  db: D1Database,
  p: { userId: number; credentialId: string; publicKey: string; counter: number; transports: string[] | undefined; label: string },
  now = new Date().toISOString(),
) {
  await db
    .prepare('INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, label, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(p.userId, p.credentialId, p.publicKey, p.counter, p.transports ? JSON.stringify(p.transports) : null, p.label.slice(0, 60), now, now)
    .run();
}

export async function markPasskeyUsed(db: D1Database, id: number, counter: number, now = new Date().toISOString()) {
  await db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').bind(counter, now, id).run();
}

export async function listPasskeys(db: D1Database, userId: number): Promise<PasskeyInfo[]> {
  const { results } = await db
    .prepare('SELECT id, label, created_at AS createdAt, last_used_at AS lastUsedAt FROM passkeys WHERE user_id = ? ORDER BY created_at')
    .bind(userId)
    .all<PasskeyInfo>();
  return results;
}

export async function renamePasskey(db: D1Database, userId: number, id: number, label: string) {
  const name = label.trim().slice(0, 60);
  if (!name) throw new ValidationError('Navnet må ikke være tomt');
  const r = await db.prepare('UPDATE passkeys SET label = ? WHERE id = ? AND user_id = ?').bind(name, id, userId).run();
  if (!r.meta.changes) throw new NotFoundError('Passkey findes ikke');
}

/** Sletter en passkey. Den sidste kan ikke slettes, så man ikke låser sig selv ude. */
export async function deletePasskey(db: D1Database, userId: number, id: number) {
  const keys = await listPasskeys(db, userId);
  if (!keys.some((k) => k.id === id)) throw new NotFoundError('Passkey findes ikke');
  if (keys.length <= 1) throw new ConflictError('Den sidste passkey kan ikke slettes');
  await db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').bind(id, userId).run();
}

// ─── WebAuthn-udfordringer ──────────────────────────────────────────────────

export async function storeChallenge(
  db: D1Database,
  c: { challenge: string; kind: 'login' | 'invite' | 'passkey'; userId?: number; inviteHash?: string },
  now = Date.now(),
): Promise<string> {
  const id = randomToken(18);
  await db.batch([
    db.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').bind(iso(now)),
    db
      .prepare('INSERT INTO webauthn_challenges (id, challenge, kind, user_id, invite_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, c.challenge, c.kind, c.userId ?? null, c.inviteHash ?? null, iso(now + CHALLENGE_TTL_MS)),
  ]);
  return id;
}

/** Henter og sletter udfordringen (den kan kun bruges én gang). */
export async function takeChallenge(
  db: D1Database,
  id: string,
  kind: 'login' | 'invite' | 'passkey',
  now = Date.now(),
): Promise<{ challenge: string; userId: number | null; inviteHash: string | null } | null> {
  const row = await db
    .prepare('SELECT challenge, kind, user_id, invite_hash, expires_at FROM webauthn_challenges WHERE id = ?')
    .bind(id)
    .first<{ challenge: string; kind: string; user_id: number | null; invite_hash: string | null; expires_at: string }>();
  if (!row) return null;
  await db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').bind(id).run();
  if (row.kind !== kind || Date.parse(row.expires_at) <= now) return null;
  return { challenge: row.challenge, userId: row.user_id, inviteHash: row.invite_hash };
}

// ─── Invitationer ───────────────────────────────────────────────────────────

export interface Invite {
  tokenHash: string;
  name: string;
  isAdmin: boolean;
  userId: number | null;
  createdBy: number | null;
}

/** Opretter en invitation (7 dage, kan bruges én gang). Returnerer tokenet til linket /invite/<token>. */
export async function createInvite(
  db: D1Database,
  opts: { name: string; isAdmin: boolean; userId?: number | null; createdBy: number | null },
  now = Date.now(),
): Promise<string> {
  const name = opts.name.trim().slice(0, 40);
  if (!name) throw new ValidationError('Navn mangler');
  if (opts.userId && !(await getUser(db, opts.userId))) throw new NotFoundError('Brugeren findes ikke');
  const token = randomToken(32);
  await db
    .prepare('INSERT INTO invites (token_hash, name, is_admin, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), name, opts.isAdmin ? 1 : 0, opts.userId ?? null, opts.createdBy, iso(now), iso(now + INVITE_TTL_MS))
    .run();
  return token;
}

/** En ubrugt, gyldig invitation, eller null. */
export async function findInvite(db: D1Database, token: string, now = Date.now()): Promise<Invite | null> {
  const hash = await sha256Hex(token);
  const r = await db
    .prepare('SELECT token_hash, name, is_admin, user_id, created_by, expires_at, used_at FROM invites WHERE token_hash = ?')
    .bind(hash)
    .first<{ token_hash: string; name: string; is_admin: number; user_id: number | null; created_by: number | null; expires_at: string; used_at: string | null }>();
  if (!r || r.used_at || Date.parse(r.expires_at) <= now) return null;
  return { tokenHash: r.token_hash, name: r.name, isAdmin: r.is_admin === 1, userId: r.user_id, createdBy: r.created_by };
}

/** Bruger invitationen: ny bruger (eller den eksisterende ved gendannelse). Fejler hvis den allerede er brugt. */
export async function redeemInvite(db: D1Database, invite: Invite, now = new Date().toISOString()): Promise<SessionUser> {
  // Gør krav på invitationen først, så to samtidige forsøg ikke begge opretter en bruger.
  const claimed = await db.prepare('UPDATE invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').bind(now, invite.tokenHash).run();
  if (!claimed.meta.changes) throw new ConflictError('Invitationen er allerede brugt');
  let userId = invite.userId;
  if (!userId) {
    const r = await db.prepare('INSERT INTO users (name, is_admin, created_at) VALUES (?, ?, ?)').bind(invite.name, invite.isAdmin ? 1 : 0, now).run();
    userId = r.meta.last_row_id;
  } else if (invite.isAdmin) {
    await db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind(userId).run();
  }
  await db.prepare('UPDATE invites SET used_by = ? WHERE token_hash = ?').bind(userId, invite.tokenHash).run();
  return (await getUser(db, userId!))!;
}

export async function markOnboarded(db: D1Database, userId: number, name: string, now = new Date().toISOString()) {
  await db.prepare('UPDATE users SET name = ?, onboarded_at = ? WHERE id = ?').bind(name, now, userId).run();
}

/** Alle brugere med deres atleter (Indstillinger → Brugere, kun admin). */
export async function listUsers(db: D1Database): Promise<UserInfo[]> {
  const { results } = await db
    .prepare('SELECT u.id, u.name, u.is_admin, (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys FROM users u ORDER BY u.id')
    .all<{ id: number; name: string; is_admin: number; passkeys: number }>();
  return Promise.all(
    results.map(async (u) => ({
      id: u.id,
      name: u.name,
      isAdmin: u.is_admin === 1,
      passkeys: u.passkeys,
      athletes: (await listAthletesForUser(db, u.id)).map((a) => ({ slug: a.slug, role: a.role })),
    })),
  );
}

export async function listOpenInvites(db: D1Database, now = Date.now()) {
  const { results } = await db
    .prepare('SELECT name, is_admin AS isAdmin, user_id AS userId, created_at AS createdAt, expires_at AS expiresAt FROM invites WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC')
    .bind(iso(now))
    .all<{ name: string; isAdmin: number; userId: number | null; createdAt: string; expiresAt: string }>();
  return results.map((r) => ({ ...r, isAdmin: r.isAdmin === 1 }));
}
