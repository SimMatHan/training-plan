// Historik og eksport. Kaldes af API'et og af MCP i fase 3.
import { assessGroin } from '../../shared/groin';
import { exerciseHistory, weeklySummary, type ExerciseHistoryEntry, type WeeklySummary } from '../../shared/history';
import { ExerciseNote, GroinCheck, ScheduleOverride, SetLog, SyncTables, Workout, type SyncTable } from '../../shared/records.schema';
import { NotFoundError } from './errors';
import { getActivePlan } from './plan';

type Row = Record<string, unknown>;

const BOOL_COLUMNS: Partial<Record<SyncTable, string[]>> = { set_logs: ['done'], mobility_checks: ['done'] };

/** Læser en tabel som validerede poster (booleans konverteret, server_updated_at fjernet). */
async function readTable<T extends SyncTable>(db: D1Database, table: T, where = '', ...params: unknown[]) {
  const { results } = await db.prepare(`SELECT * FROM ${table} ${where}`).bind(...params).all<Row>();
  const bools = BOOL_COLUMNS[table] ?? [];
  return results.map((r) => {
    for (const b of bools) r[b] = r[b] === 1;
    return SyncTables[table].parse(r);
  });
}

const today = () => new Date().toISOString().slice(0, 10);

/** Alle gange en øvelse er logget, nyeste først. */
export async function getExerciseHistory(db: D1Database, exerciseId: string, limit?: number): Promise<ExerciseHistoryEntry[]> {
  // Subqueries i stedet for IN (?, ?, …): D1 tillader højst 100 parametre pr. forespørgsel.
  const [sets, workouts, notes] = await Promise.all([
    readTable(db, 'set_logs', 'WHERE exercise_id = ? AND deleted_at IS NULL', exerciseId) as Promise<SetLog[]>,
    readTable(db, 'workouts', 'WHERE uuid IN (SELECT workout_uuid FROM set_logs WHERE exercise_id = ?)', exerciseId) as Promise<Workout[]>,
    readTable(db, 'exercise_notes', 'WHERE exercise_id = ?', exerciseId) as Promise<ExerciseNote[]>,
  ]);
  return exerciseHistory(exerciseId, workouts, sets, notes, limit);
}

/** Ugens sessioner, volumen pr. øvelse, løbe-km og trafiklys. */
export async function getWeeklySummary(db: D1Database, weekNo: number, asOf = today()): Promise<WeeklySummary> {
  const { plan } = await getActivePlan(db);
  if (!plan.weeks.some((w) => w.weekNo === weekNo)) throw new NotFoundError(`Uge ${weekNo} findes ikke i planen`);
  const workouts = (await readTable(db, 'workouts', 'WHERE deleted_at IS NULL')) as Workout[];
  const [sets, checks, overrides] = await Promise.all([
    readTable(db, 'set_logs', 'WHERE deleted_at IS NULL AND workout_uuid IN (SELECT uuid FROM workouts WHERE week_no = ?)', weekNo) as Promise<SetLog[]>,
    readTable(db, 'groin_checks', 'WHERE deleted_at IS NULL') as Promise<GroinCheck[]>,
    readTable(db, 'schedule_overrides', 'WHERE deleted_at IS NULL AND week_no = ?', weekNo) as Promise<ScheduleOverride[]>,
  ]);
  return weeklySummary(plan, weekNo, workouts, sets, assessGroin(workouts, checks, asOf), overrides);
}

/** Alt i databasen som ét JSON-dokument: planversioner og alle logtabeller. */
export async function exportAll(db: D1Database) {
  const { results: versions } = await db.prepare('SELECT * FROM plan_versions ORDER BY version').all<Row>();
  const tables: Partial<Record<SyncTable, unknown[]>> = {};
  for (const table of Object.keys(SyncTables) as SyncTable[]) tables[table] = await readTable(db, table);
  return {
    format: 'traeningsnav-eksport',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    planVersions: versions.map(({ plan_json, is_active, ...v }) => ({ ...v, is_active: is_active === 1, plan: JSON.parse(plan_json as string) })),
    ...tables,
  };
}
