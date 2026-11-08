// Plan-services. Ren forretningslogik uden HTTP: kaldes af API-routes og MCP-værktøjer.
// Fase 5: alle funktioner tager athleteId som første parameter efter db, og hver forespørgsel
// har WHERE athlete_id = ?. Planversioner nummereres pr. atlet.
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

// plan_json ændres aldrig for en eksisterende version, så den parsede plan kan caches pr.
// (atlet, version) — pr. database, så tests med hver deres database ikke deler cache.
const planCaches = new WeakMap<D1Database, Map<string, Plan>>();

async function loadPlan(db: D1Database, athleteId: number, version: number): Promise<Plan> {
  let planCache = planCaches.get(db);
  if (!planCache) planCaches.set(db, (planCache = new Map()));
  const key = `${athleteId}:${version}`;
  const cached = planCache.get(key);
  if (cached) return cached;
  const row = await db
    .prepare('SELECT plan_json FROM plan_versions WHERE athlete_id = ? AND version = ?')
    .bind(athleteId, version)
    .first<{ plan_json: string }>();
  if (!row) throw new NotFoundError(`Planversion ${version} findes ikke`);
  const plan = PlanSchema.parse(JSON.parse(row.plan_json));
  planCache.set(key, plan);
  return plan;
}

export async function listPlanVersions(db: D1Database, athleteId: number): Promise<PlanVersionMeta[]> {
  const { results } = await db
    .prepare(`SELECT ${META_COLUMNS} FROM plan_versions WHERE athlete_id = ? ORDER BY version DESC`)
    .bind(athleteId)
    .all<PlanVersionRow>();
  return results.map(toMeta);
}

export async function getPlanVersion(db: D1Database, athleteId: number, version: number): Promise<{ meta: PlanVersionMeta; plan: Plan }> {
  const row = await db
    .prepare(`SELECT ${META_COLUMNS} FROM plan_versions WHERE athlete_id = ? AND version = ?`)
    .bind(athleteId, version)
    .first<PlanVersionRow>();
  if (!row) throw new NotFoundError(`Planversion ${version} findes ikke`);
  return { meta: toMeta(row), plan: await loadPlan(db, athleteId, version) };
}

/**
 * Hvornår den plan, `version` hører til, begyndte. En plan er en række versioner: rettelser og godkendte
 * ændringer bygger videre på den samme plan, mens en ny plan (godkendt "ny plan"-forslag, en seed eller en
 * version med en anden startdato end den før) begynder forfra fra uge 1. Tidspunktet er forslagets, hvis
 * planen kom fra et forslag, så noter Claude skrev til den nye plan, før den blev godkendt, også hører til,
 * og højst dagen før planens startdato. Bruges til at skille noter og flytninger med samme ugenummer fra en tidligere plan fra.
 */
export async function planStartedAt(db: D1Database, athleteId: number, version: number): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT v.version, v.created_at, v.source, json_extract(v.plan_json, '$.startDate') AS start,
         (SELECT MIN(p.created_at) FROM plan_proposals p WHERE p.athlete_id = v.athlete_id AND p.result_version = v.version AND p.kind = 'ny-plan') AS proposed_at
       FROM plan_versions v WHERE v.athlete_id = ? AND v.version <= ? ORDER BY v.version DESC`,
    )
    .bind(athleteId, version)
    .all<{ version: number; created_at: string; source: string; start: string; proposed_at: string | null }>();
  for (const [i, row] of results.entries()) {
    const before = results[i + 1];
    if (row.proposed_at || row.source === 'seed' || !before || before.start !== row.start) {
      // Højst dagen før planens startdato: en plan lagt ind efter sin start (seed, script) har sine egne
      // noter og flytninger fra før, versionen blev oprettet.
      const dayBefore = new Date(Date.parse(`${results[0].start}T00:00:00.000Z`) - 86_400_000).toISOString();
      const at = row.proposed_at ?? row.created_at;
      return at < dayBefore ? at : dayBefore;
    }
  }
  throw new NotFoundError(`Planversion ${version} findes ikke`);
}

export interface ActivePlan {
  meta: PlanVersionMeta;
  plan: Plan;
  /** Hvornår planen begyndte (planStartedAt). */
  startedAt: string;
}

/** Den aktive planversion, eller null hvis atleten ingen plan har endnu. */
export async function findActivePlan(db: D1Database, athleteId: number): Promise<ActivePlan | null> {
  const row = await db
    .prepare(`SELECT ${META_COLUMNS} FROM plan_versions WHERE athlete_id = ? AND is_active = 1`)
    .bind(athleteId)
    .first<PlanVersionRow>();
  if (!row) return null;
  const [plan, startedAt] = await Promise.all([loadPlan(db, athleteId, row.version), planStartedAt(db, athleteId, row.version)]);
  return { meta: toMeta(row), plan, startedAt };
}

/** Den aktive planversion. Appen læser altid planen herfra. */
export async function getActivePlan(db: D1Database, athleteId: number): Promise<ActivePlan> {
  const active = await findActivePlan(db, athleteId);
  if (!active) throw new NotFoundError('Ingen aktiv planversion endnu. En ny plan foreslås med foreslaa_ny_plan og godkendes i appen');
  return active;
}

/**
 * Gør en eksisterende version aktiv (versionsskift og tilbagerulning).
 * Alle opdateringer køres i én batch, som D1 udfører som en transaktion.
 */
export async function activatePlanVersion(db: D1Database, athleteId: number, version: number, now = new Date().toISOString()): Promise<PlanVersionMeta> {
  const exists = await db.prepare('SELECT 1 FROM plan_versions WHERE athlete_id = ? AND version = ?').bind(athleteId, version).first();
  if (!exists) throw new NotFoundError(`Planversion ${version} findes ikke`);
  await db.batch([
    db.prepare('UPDATE plan_versions SET is_active = 0 WHERE athlete_id = ? AND is_active = 1 AND version <> ?').bind(athleteId, version),
    // activated_at: kalenderfeedet tæller skiftet som en ændring af alle events (SEQUENCE).
    db.prepare('UPDATE plan_versions SET is_active = 1, activated_at = ? WHERE athlete_id = ? AND version = ?').bind(now, athleteId, version),
    // Claudes ventende patch-forslag mod en anden version kan ikke længere anvendes.
    db
      .prepare("UPDATE plan_proposals SET status = 'forældet', decided_at = ? WHERE athlete_id = ? AND status = 'afventer' AND kind = 'patch' AND base_version <> ?")
      .bind(now, athleteId, version),
  ]);
  return (await getPlanVersion(db, athleteId, version)).meta;
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

/** Flytninger af planlagte sessioner i en uge, skrevet efter planen begyndte (`startedAt`, se planStartedAt). */
export async function getScheduleOverrides(db: D1Database, athleteId: number, weekNo: number, startedAt: string): Promise<ScheduleOverride[]> {
  const { results } = await db
    .prepare('SELECT * FROM schedule_overrides WHERE athlete_id = ? AND week_no = ? AND deleted_at IS NULL AND updated_at >= ?')
    .bind(athleteId, weekNo, startedAt)
    .all<Record<string, unknown>>();
  return results.map((r) => ScheduleOverride.parse(r));
}

/** Én uge i den aktive plan med sessioner (inkl. flytninger) og konkret dosering. */
export async function getWeek(db: D1Database, athleteId: number, weekNo: number): Promise<WeekView> {
  const { meta, plan, startedAt } = await getActivePlan(db, athleteId);
  return buildWeekView(plan, meta.version, weekNo, await getScheduleOverrides(db, athleteId, weekNo, startedAt));
}

/** Ugenummer for en dato (YYYY-MM-DD) i den aktive plan, eller null uden for planen. */
export async function getWeekNoForDate(db: D1Database, athleteId: number, date: string): Promise<number | null> {
  const { plan } = await getActivePlan(db, athleteId);
  return weekForDate(plan, date)?.weekNo ?? null;
}
