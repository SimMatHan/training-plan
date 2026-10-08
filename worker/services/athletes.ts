// Atleter, adgang (ejer/træner), profil og overvågning (monitors og mobilitetstests).
// Al adgang til en atlets data går gennem resolveAccess (via requireAccess i worker/auth.ts).
import { z } from 'zod';
import { ROLE_RANK, type AccessEntry, type AthleteRef, type MobilityTest, type Monitor, type Profile, type Role, type Sharing } from '../../shared/athletes';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors';

export interface Athlete {
  id: number;
  slug: string;
  name: string;
  threshold_hr: number | null;
}

export interface Access {
  userId: number;
  athleteId: number;
  athlete: Athlete;
  role: Role;
}

export const AthleteSlug = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'Ugyldig atlet');

export async function getAthleteBySlug(db: D1Database, slug: string): Promise<Athlete | null> {
  if (!AthleteSlug.safeParse(slug).success) return null;
  return db.prepare('SELECT id, slug, name, threshold_hr FROM athletes WHERE slug = ?').bind(slug).first<Athlete>();
}

export async function getAthlete(db: D1Database, athleteId: number): Promise<Athlete> {
  const a = await db.prepare('SELECT id, slug, name, threshold_hr FROM athletes WHERE id = ?').bind(athleteId).first<Athlete>();
  if (!a) throw new NotFoundError('Atleten findes ikke');
  return a;
}

export async function getRole(db: D1Database, userId: number, athleteId: number): Promise<Role | null> {
  return db.prepare('SELECT role FROM athlete_access WHERE user_id = ? AND athlete_id = ?').bind(userId, athleteId).first<Role>('role');
}

/**
 * Brugerens adgang til atleten med mindst `minRole`. En atlet brugeren ikke har adgang til giver
 * 404 (ikke 403), så andre atleters eksistens ikke afsløres. Adgang med for lav rolle giver 403.
 */
export async function resolveAccess(db: D1Database, userId: number, slug: string, minRole: Role): Promise<Access> {
  const athlete = await getAthleteBySlug(db, slug);
  const role = athlete ? await getRole(db, userId, athlete.id) : null;
  if (!athlete || !role) throw new NotFoundError('Ikke fundet');
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) throw new ForbiddenError(minRole === 'ejer' ? 'Kun atleten selv kan gøre det' : 'Ingen adgang');
  return { userId, athleteId: athlete.id, athlete, role };
}

/** Atleter brugeren har adgang til: egne (ejer) først, derefter som træner, alfabetisk. */
export async function listAthletesForUser(db: D1Database, userId: number): Promise<AthleteRef[]> {
  const { results } = await db
    .prepare(
      "SELECT a.slug, a.name, x.role FROM athlete_access x JOIN athletes a ON a.id = x.athlete_id WHERE x.user_id = ? ORDER BY x.role = 'ejer' DESC, a.name",
    )
    .bind(userId)
    .all<AthleteRef>();
  return results;
}

/** Brugerens egen atlet (rollen ejer), hvis der er en. */
export async function ownAthlete(db: D1Database, userId: number): Promise<Athlete | null> {
  return db
    .prepare("SELECT a.id, a.slug, a.name, a.threshold_hr FROM athlete_access x JOIN athletes a ON a.id = x.athlete_id WHERE x.user_id = ? AND x.role = 'ejer' ORDER BY a.id LIMIT 1")
    .bind(userId)
    .first<Athlete>();
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 30) || 'atlet';

/** Opretter brugerens egen atlet med en unik slug ud fra navnet (karo, karo-2 …). */
export async function createAthleteForUser(db: D1Database, userId: number, name: string, now = new Date().toISOString()): Promise<Athlete> {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; await getAthleteBySlug(db, slug); i++) slug = `${base}-${i}`;
  await db.batch([
    db.prepare('INSERT INTO athletes (slug, name, created_at) VALUES (?, ?, ?)').bind(slug, name, now),
    db.prepare("INSERT INTO athlete_access (user_id, athlete_id, role, granted_at) SELECT ?, id, 'ejer', ? FROM athletes WHERE slug = ?").bind(userId, now, slug),
  ]);
  return (await getAthleteBySlug(db, slug))!;
}

export const AthleteUpdate = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  thresholdHr: z.int().min(80).max(230).nullable().optional(),
});

export async function updateAthlete(db: D1Database, athleteId: number, raw: unknown): Promise<Athlete> {
  const input = AthleteUpdate.parse(raw);
  if (input.name !== undefined) await db.prepare('UPDATE athletes SET name = ? WHERE id = ?').bind(input.name, athleteId).run();
  if (input.thresholdHr !== undefined) await db.prepare('UPDATE athletes SET threshold_hr = ? WHERE id = ?').bind(input.thresholdHr, athleteId).run();
  return getAthlete(db, athleteId);
}

// ─── Overvågning ────────────────────────────────────────────────────────────

interface MonitorRow {
  id: number;
  label: string;
  active: number;
  sort: number;
}
interface TestRow {
  id: number;
  name: string;
  unit: string;
  per_side: number;
  active: number;
  instructions: string | null;
}

export async function listMonitors(db: D1Database, athleteId: number): Promise<Monitor[]> {
  const { results } = await db.prepare('SELECT id, label, active, sort FROM monitors WHERE athlete_id = ? ORDER BY sort, id').bind(athleteId).all<MonitorRow>();
  return results.map((r) => ({ ...r, active: r.active === 1 }));
}

export async function listMobilityTests(db: D1Database, athleteId: number): Promise<MobilityTest[]> {
  const { results } = await db
    .prepare('SELECT id, name, unit, per_side, active, instructions FROM mobility_tests WHERE athlete_id = ? ORDER BY id')
    .bind(athleteId)
    .all<TestRow>();
  return results.map((r) => ({ ...r, per_side: r.per_side === 1, active: r.active === 1 }));
}

export async function getProfile(db: D1Database, access: Pick<Access, 'athlete' | 'role'>): Promise<Profile> {
  const [monitors, mobilityTests] = await Promise.all([listMonitors(db, access.athlete.id), listMobilityTests(db, access.athlete.id)]);
  return {
    athlete: { slug: access.athlete.slug, name: access.athlete.name, thresholdHr: access.athlete.threshold_hr },
    role: access.role,
    monitors,
    mobilityTests,
  };
}

export const MonitorInput = z.object({ label: z.string().trim().min(1).max(40) });
export const MonitorUpdate = z.object({ label: z.string().trim().min(1).max(40).optional(), active: z.boolean().optional(), sort: z.int().min(0).max(100).optional() });
export const TestInput = z.object({
  name: z.string().trim().min(1).max(40),
  unit: z.string().trim().min(1).max(12),
  perSide: z.boolean(),
  instructions: z.string().trim().max(1000).nullable().default(null),
});
export const TestUpdate = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  unit: z.string().trim().min(1).max(12).optional(),
  active: z.boolean().optional(),
  instructions: z.string().trim().max(1000).nullable().optional(),
});

export async function addMonitor(db: D1Database, athleteId: number, raw: unknown): Promise<Monitor> {
  const { label } = MonitorInput.parse(raw);
  const max = await db.prepare('SELECT COALESCE(MAX(sort), -1) AS s FROM monitors WHERE athlete_id = ?').bind(athleteId).first<number>('s');
  const r = await db.prepare('INSERT INTO monitors (athlete_id, label, active, sort) VALUES (?, ?, 1, ?)').bind(athleteId, label, (max ?? -1) + 1).run();
  return (await listMonitors(db, athleteId)).find((m) => m.id === r.meta.last_row_id)!;
}

export async function updateMonitor(db: D1Database, athleteId: number, id: number, raw: unknown): Promise<Monitor> {
  const input = MonitorUpdate.parse(raw);
  const existing = (await listMonitors(db, athleteId)).find((m) => m.id === id);
  if (!existing) throw new NotFoundError('Monitoren findes ikke');
  const next = { ...existing, ...input };
  await db
    .prepare('UPDATE monitors SET label = ?, active = ?, sort = ? WHERE id = ? AND athlete_id = ?')
    .bind(next.label, next.active ? 1 : 0, next.sort, id, athleteId)
    .run();
  return next;
}

export async function addMobilityTest(db: D1Database, athleteId: number, raw: unknown): Promise<MobilityTest> {
  const t = TestInput.parse(raw);
  const r = await db
    .prepare('INSERT INTO mobility_tests (athlete_id, name, unit, per_side, active, instructions) VALUES (?, ?, ?, ?, 1, ?)')
    .bind(athleteId, t.name, t.unit, t.perSide ? 1 : 0, t.instructions)
    .run();
  return (await listMobilityTests(db, athleteId)).find((x) => x.id === r.meta.last_row_id)!;
}

export async function updateMobilityTest(db: D1Database, athleteId: number, id: number, raw: unknown): Promise<MobilityTest> {
  const input = TestUpdate.parse(raw);
  const existing = (await listMobilityTests(db, athleteId)).find((t) => t.id === id);
  if (!existing) throw new NotFoundError('Testen findes ikke');
  const next = { ...existing, ...input };
  await db
    .prepare('UPDATE mobility_tests SET name = ?, unit = ?, active = ?, instructions = ? WHERE id = ? AND athlete_id = ?')
    .bind(next.name, next.unit, next.active ? 1 : 0, next.instructions, id, athleteId)
    .run();
  return next;
}

// ─── Deling ─────────────────────────────────────────────────────────────────

/** Hvem har adgang til atleten, og hvem kan få trænerrollen (den der inviterede ejeren). */
export async function getSharing(db: D1Database, athleteId: number, ownerUserId: number): Promise<Sharing> {
  const { results: access } = await db
    .prepare('SELECT x.user_id AS userId, u.name, x.role, x.granted_at AS grantedAt FROM athlete_access x JOIN users u ON u.id = x.user_id WHERE x.athlete_id = ? ORDER BY x.role = \'ejer\' DESC, x.granted_at')
    .bind(athleteId)
    .all<AccessEntry>();
  const { results: candidates } = await db
    .prepare(
      'SELECT DISTINCT u.id AS userId, u.name FROM invites i JOIN users u ON u.id = i.created_by WHERE i.used_by = ? AND u.id <> ? ' +
        'AND u.id NOT IN (SELECT user_id FROM athlete_access WHERE athlete_id = ?)',
    )
    .bind(ownerUserId, ownerUserId, athleteId)
    .all<{ userId: number; name: string }>();
  return { access, candidates };
}

/** Giver en bruger trænerrollen. Kun brugere fra getSharing().candidates. */
export async function grantCoach(db: D1Database, athleteId: number, ownerUserId: number, userId: number, now = new Date().toISOString()) {
  const { candidates } = await getSharing(db, athleteId, ownerUserId);
  if (!candidates.some((c) => c.userId === userId)) throw new NotFoundError('Brugeren kan ikke få adgang herfra');
  await db.prepare("INSERT INTO athlete_access (user_id, athlete_id, role, granted_at) VALUES (?, ?, 'traener', ?)").bind(userId, athleteId, now).run();
}

/** Fjerner en træners adgang. Virker straks, også for Claude-forbindelser (MCP slår adgangen op ved hvert kald). */
export async function revokeAccess(db: D1Database, athleteId: number, userId: number) {
  const role = await getRole(db, userId, athleteId);
  if (!role) throw new NotFoundError('Brugeren har ikke adgang');
  if (role === 'ejer') throw new ConflictError('Ejerens adgang kan ikke fjernes');
  await db.prepare("DELETE FROM athlete_access WHERE user_id = ? AND athlete_id = ? AND role = 'traener'").bind(userId, athleteId).run();
}

export const assertPositiveId = (s: string, what: string) => {
  const r = z.coerce.number().int().min(1).safeParse(s);
  if (!r.success) throw new ValidationError(`Ugyldigt ${what}: ${s}`);
  return r.data;
};
