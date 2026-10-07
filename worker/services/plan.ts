// Plan-services. Ren forretningslogik uden HTTP: kaldes af API-routes nu og af
// MCP-værktøjer i fase 3 (getActivePlan, getWeek …).
import { PlanSchema, type Plan, type Session, type Week } from '../../shared/plan.schema';
import { ScheduleOverride, type PlanVersionMeta } from '../../shared/records.schema';
import { effectiveSessions, type EffectiveSession } from '../../shared/schedule';
import { dateOfDay, getSession, resolveStrengthSession, weekForDate, type ResolvedStrengthSession } from '../../shared/resolve';
import { NotFoundError } from './errors';

interface PlanVersionRow {
  id: number;
  version: number;
  created_at: string;
  source: PlanVersionMeta['source'];
  note: string | null;
  based_on_version: number | null;
  is_active: number;
}

const META_COLUMNS = 'id, version, created_at, source, note, based_on_version, is_active';

const toMeta = (r: PlanVersionRow): PlanVersionMeta => ({ ...r, is_active: r.is_active === 1 });

// plan_json ændres aldrig for en eksisterende version, så den parsede plan kan caches pr. version
// (pr. database, så tests med hver deres database ikke deler cache).
const planCaches = new WeakMap<D1Database, Map<number, Plan>>();

async function loadPlan(db: D1Database, version: number): Promise<Plan> {
  let planCache = planCaches.get(db);
  if (!planCache) planCaches.set(db, (planCache = new Map()));
  const cached = planCache.get(version);
  if (cached) return cached;
  const row = await db.prepare('SELECT plan_json FROM plan_versions WHERE version = ?').bind(version).first<{ plan_json: string }>();
  if (!row) throw new NotFoundError(`Planversion ${version} findes ikke`);
  const plan = PlanSchema.parse(JSON.parse(row.plan_json));
  planCache.set(version, plan);
  return plan;
}

export async function listPlanVersions(db: D1Database): Promise<PlanVersionMeta[]> {
  const { results } = await db.prepare(`SELECT ${META_COLUMNS} FROM plan_versions ORDER BY version DESC`).all<PlanVersionRow>();
  return results.map(toMeta);
}

export async function getPlanVersion(db: D1Database, version: number): Promise<{ meta: PlanVersionMeta; plan: Plan }> {
  const row = await db.prepare(`SELECT ${META_COLUMNS} FROM plan_versions WHERE version = ?`).bind(version).first<PlanVersionRow>();
  if (!row) throw new NotFoundError(`Planversion ${version} findes ikke`);
  return { meta: toMeta(row), plan: await loadPlan(db, version) };
}

/** Den aktive planversion. Appen læser altid planen herfra. */
export async function getActivePlan(db: D1Database): Promise<{ meta: PlanVersionMeta; plan: Plan }> {
  const row = await db.prepare(`SELECT ${META_COLUMNS} FROM plan_versions WHERE is_active = 1`).first<PlanVersionRow>();
  if (!row) throw new NotFoundError('Ingen aktiv planversion — kør seed (se README)');
  return { meta: toMeta(row), plan: await loadPlan(db, row.version) };
}

/**
 * Gør en eksisterende version aktiv (versionsskift og tilbagerulning).
 * Begge opdateringer køres i én batch, som D1 udfører som en transaktion.
 */
export async function activatePlanVersion(db: D1Database, version: number, now = new Date().toISOString()): Promise<PlanVersionMeta> {
  const exists = await db.prepare('SELECT 1 FROM plan_versions WHERE version = ?').bind(version).first();
  if (!exists) throw new NotFoundError(`Planversion ${version} findes ikke`);
  await db.batch([
    db.prepare('UPDATE plan_versions SET is_active = 0 WHERE is_active = 1 AND version <> ?').bind(version),
    // activated_at: kalenderfeedet tæller skiftet som en ændring af alle events (SEQUENCE).
    db.prepare('UPDATE plan_versions SET is_active = 1, activated_at = ? WHERE version = ?').bind(now, version),
    // Claudes ventende forslag mod en anden version kan ikke længere anvendes.
    db.prepare("UPDATE plan_proposals SET status = 'forældet', decided_at = ? WHERE status = 'afventer' AND base_version <> ?").bind(now, version),
  ]);
  return (await getPlanVersion(db, version)).meta;
}

export interface WeekSession {
  /** Planens session med faktisk dag (efter evt. flytning) og planens dag. */
  scheduled: EffectiveSession;
  date: string;
  session: Session;
  /** Konkrete øvelser og sæt for styrkesessioner. */
  strength?: ResolvedStrengthSession;
}

export interface WeekView {
  planVersion: number;
  week: Week;
  endDate: string;
  sessions: WeekSession[];
}

export function buildWeekView(plan: Plan, planVersion: number, weekNo: number, overrides: ScheduleOverride[] = []): WeekView {
  const week = plan.weeks.find((w) => w.weekNo === weekNo);
  if (!week) throw new NotFoundError(`Uge ${weekNo} findes ikke i planen`);
  const sessions = effectiveSessions(week, overrides).map((scheduled): WeekSession => {
    const session = getSession(plan, scheduled.sessionId)!;
    return {
      scheduled,
      date: dateOfDay(week, scheduled.day),
      session,
      ...(session.kind === 'styrke' && { strength: resolveStrengthSession(plan, session.id, weekNo) }),
    };
  });
  return { planVersion, week, endDate: dateOfDay(week, 7), sessions };
}

/** Flytninger af planlagte sessioner i en uge. */
export async function getScheduleOverrides(db: D1Database, weekNo: number): Promise<ScheduleOverride[]> {
  const { results } = await db
    .prepare('SELECT * FROM schedule_overrides WHERE week_no = ? AND deleted_at IS NULL')
    .bind(weekNo)
    .all<Record<string, unknown>>();
  return results.map((r) => ScheduleOverride.parse(r));
}

/** Én uge i den aktive plan med sessioner (inkl. flytninger) og konkret dosering. */
export async function getWeek(db: D1Database, weekNo: number): Promise<WeekView> {
  const { meta, plan } = await getActivePlan(db);
  return buildWeekView(plan, meta.version, weekNo, await getScheduleOverrides(db, weekNo));
}

/** Ugenummer for en dato (YYYY-MM-DD) i den aktive plan, eller null uden for planen. */
export async function getWeekNoForDate(db: D1Database, date: string): Promise<number | null> {
  const { plan } = await getActivePlan(db);
  return weekForDate(plan, date)?.weekNo ?? null;
}
