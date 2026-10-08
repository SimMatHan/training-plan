// Historik og eksport. Kaldes af API'et og af MCP. Alt er pr. atlet.
import { assessAllPain } from '../../shared/pain';
import { exerciseHistory, weeklySummary, type ExerciseHistoryEntry, type WeeklySummary } from '../../shared/history';
import { ExerciseNote, PainScore, ScheduleOverride, SetLog, SyncTables, Workout, type SyncTable } from '../../shared/records.schema';
import { listMonitors } from './athletes';
import { NotFoundError } from './errors';
import { getActivePlan } from './plan';

type Row = Record<string, unknown>;

const BOOL_COLUMNS: Partial<Record<SyncTable, string[]>> = { set_logs: ['done'], mobility_checks: ['done'] };

/**
 * Læser en atlets rækker i en tabel som validerede poster (booleans konverteret, server_updated_at
 * og athlete_id fjernet). `condition` er en ekstra SQL-betingelse med parametre.
 */
export async function readTable<T extends SyncTable>(db: D1Database, athleteId: number, table: T, condition = '', ...params: unknown[]) {
  const { results } = await db
    .prepare(`SELECT * FROM ${table} WHERE athlete_id = ?${condition ? ` AND (${condition})` : ''}`)
    .bind(athleteId, ...params)
    .all<Row>();
  const bools = BOOL_COLUMNS[table] ?? [];
  return results.map((r) => {
    for (const b of bools) r[b] = r[b] === 1;
    return SyncTables[table].parse(r);
  });
}

const today = () => new Date().toISOString().slice(0, 10);

/** Alle gange en øvelse er logget, nyeste først. */
export async function getExerciseHistory(db: D1Database, athleteId: number, exerciseId: string, limit?: number): Promise<ExerciseHistoryEntry[]> {
  // Subqueries i stedet for IN (?, ?, …): D1 tillader højst 100 parametre pr. forespørgsel.
  const [sets, workouts, notes] = await Promise.all([
    readTable(db, athleteId, 'set_logs', 'exercise_id = ? AND deleted_at IS NULL', exerciseId) as Promise<SetLog[]>,
    readTable(db, athleteId, 'workouts', 'uuid IN (SELECT workout_uuid FROM set_logs WHERE athlete_id = ? AND exercise_id = ?)', athleteId, exerciseId) as Promise<
      Workout[]
    >,
    readTable(db, athleteId, 'exercise_notes', 'exercise_id = ?', exerciseId) as Promise<ExerciseNote[]>,
  ]);
  return exerciseHistory(exerciseId, workouts, sets, notes, limit);
}

export interface ExerciseOverviewEntry {
  exerciseId: string;
  times: number;
  last: ExerciseHistoryEntry;
}

/** Alle øvelser med historik, senest trænede først (trænervisningen i appen). */
export async function getExerciseOverview(db: D1Database, athleteId: number): Promise<ExerciseOverviewEntry[]> {
  const [workouts, sets, notes] = await Promise.all([
    readTable(db, athleteId, 'workouts', 'deleted_at IS NULL') as Promise<Workout[]>,
    readTable(db, athleteId, 'set_logs', 'deleted_at IS NULL') as Promise<SetLog[]>,
    readTable(db, athleteId, 'exercise_notes', 'deleted_at IS NULL') as Promise<ExerciseNote[]>,
  ]);
  return [...new Set(sets.map((s) => s.exercise_id))]
    .map((id) => {
      const entries = exerciseHistory(id, workouts, sets, notes);
      return entries.length ? { exerciseId: id, times: entries.length, last: entries[0] } : null;
    })
    .filter((o): o is ExerciseOverviewEntry => o !== null)
    .sort((a, b) => b.last.date.localeCompare(a.last.date));
}

/** Alle smertescorer for atleten (ikke slettede). */
export const readPainScores = (db: D1Database, athleteId: number) => readTable(db, athleteId, 'pain_scores', 'deleted_at IS NULL') as Promise<PainScore[]>;

/** Ugens sessioner, volumen pr. øvelse, løbe-km og trafiklys. */
export async function getWeeklySummary(db: D1Database, athleteId: number, weekNo: number, asOf = today()): Promise<WeeklySummary> {
  const { plan } = await getActivePlan(db, athleteId);
  if (!plan.weeks.some((w) => w.weekNo === weekNo)) throw new NotFoundError(`Uge ${weekNo} findes ikke i planen`);
  const workouts = (await readTable(db, athleteId, 'workouts', 'deleted_at IS NULL')) as Workout[];
  const [sets, scores, overrides, monitors] = await Promise.all([
    readTable(db, athleteId, 'set_logs', 'deleted_at IS NULL AND workout_uuid IN (SELECT uuid FROM workouts WHERE athlete_id = ? AND week_no = ?)', athleteId, weekNo) as Promise<
      SetLog[]
    >,
    readPainScores(db, athleteId),
    readTable(db, athleteId, 'schedule_overrides', 'deleted_at IS NULL AND week_no = ?', weekNo) as Promise<ScheduleOverride[]>,
    listMonitors(db, athleteId),
  ]);
  const pain = assessAllPain(workouts, scores, monitors.filter((m) => m.active).map((m) => m.id), asOf);
  return weeklySummary(plan, weekNo, workouts, sets, pain, overrides);
}

/** Alt for én atlet som ét JSON-dokument: profil, planversioner, forslag og alle logtabeller. */
export async function exportAll(db: D1Database, athleteId: number) {
  const athlete = await db.prepare('SELECT slug, name, threshold_hr FROM athletes WHERE id = ?').bind(athleteId).first<Row>();
  const { results: versions } = await db.prepare('SELECT * FROM plan_versions WHERE athlete_id = ? ORDER BY version').bind(athleteId).all<Row>();
  const { results: proposals } = await db.prepare('SELECT * FROM plan_proposals WHERE athlete_id = ? ORDER BY created_at').bind(athleteId).all<Row>();
  const { results: monitors } = await db.prepare('SELECT id, label, active, sort FROM monitors WHERE athlete_id = ? ORDER BY sort, id').bind(athleteId).all<Row>();
  const { results: tests } = await db
    .prepare('SELECT id, name, unit, per_side, active, instructions FROM mobility_tests WHERE athlete_id = ? ORDER BY id')
    .bind(athleteId)
    .all<Row>();
  const tables: Partial<Record<SyncTable, unknown[]>> = {};
  for (const table of Object.keys(SyncTables) as SyncTable[]) tables[table] = await readTable(db, athleteId, table);
  return {
    format: 'traeningsnav-eksport',
    formatVersion: 2,
    exportedAt: new Date().toISOString(),
    athlete,
    monitors,
    mobilityTests: tests,
    planVersions: versions.map(({ plan_json, is_active, athlete_id: _a, ...v }) => ({ ...v, is_active: is_active === 1, plan: JSON.parse(plan_json as string) })),
    ...tables,
    planProposals: proposals.map(({ patch_json, payload_json, athlete_id: _a, ...p }) => ({
      ...p,
      patch: patch_json ? JSON.parse(patch_json as string) : null,
      payload: payload_json ? JSON.parse(payload_json as string) : null,
    })),
  };
}
