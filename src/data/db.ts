// Lokal database (IndexedDB via Dexie), én pr. bruger: "traeningsnav-<userId>". Alt logges her
// først; udbakken (outbox) holder styr på hvad der mangler at blive sendt til D1.
// "Log ud" sletter databasen. Udløber sessionen blot, bevares den, så udbakken sendes efter login.
import Dexie, { type Table } from 'dexie';
import type {
  CoachNote,
  ExerciseNote,
  MobilityCheck,
  MobilityMeasurement,
  PainScore,
  ScheduleOverride,
  SetLog,
  SyncTable,
  Workout,
} from '../../shared/records.schema';

export interface KvRow {
  key: string;
  value: unknown;
}

/** Én række pr. post der venter på sync. Gentagne ændringer samles i samme række. */
export interface OutboxRow {
  key: string; // `${table}:${uuid}`
  table: SyncTable;
  uuid: string;
  /** Atleten posten hører til. Serveren afviser poster til en atlet brugeren ikke ejer. */
  athleteSlug: string;
  queuedAt: string;
}

export interface RecordTypes {
  workouts: Workout;
  set_logs: SetLog;
  exercise_notes: ExerciseNote;
  pain_scores: PainScore;
  mobility_measurements: MobilityMeasurement;
  mobility_checks: MobilityCheck;
  schedule_overrides: ScheduleOverride;
  coach_notes: CoachNote;
}

export class LocalDb extends Dexie {
  kv!: Table<KvRow, string>;
  outbox!: Table<OutboxRow, string>;
  workouts!: Table<Workout, string>;
  set_logs!: Table<SetLog, string>;
  exercise_notes!: Table<ExerciseNote, string>;
  pain_scores!: Table<PainScore, string>;
  mobility_measurements!: Table<MobilityMeasurement, string>;
  mobility_checks!: Table<MobilityCheck, string>;
  schedule_overrides!: Table<ScheduleOverride, string>;
  coach_notes!: Table<CoachNote, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      kv: 'key',
      outbox: 'key, queuedAt',
      workouts: 'uuid, date, week_no, planned_session_id',
      set_logs: 'uuid, workout_uuid, exercise_id',
      exercise_notes: 'uuid, workout_uuid, exercise_id',
      pain_scores: 'uuid, date, workout_uuid, monitor_id',
      mobility_measurements: 'uuid, date, test_id',
      mobility_checks: 'uuid, workout_uuid',
      schedule_overrides: 'uuid, week_no',
      coach_notes: 'uuid, week_no',
    });
  }
}

export const dbName = (userId: number) => `traeningsnav-${userId}`;

/** Den indloggede brugers database. Sættes af openUserDb ved login, før appen vises. */
export let db = undefined as unknown as LocalDb;

export function openUserDb(userId: number): LocalDb {
  if (db?.name !== dbName(userId)) {
    db?.close();
    db = new LocalDb(dbName(userId));
  }
  return db;
}

/** Sletter brugerens lokale database (ved "Log ud"). */
export async function deleteUserDb(): Promise<void> {
  if (!db) return;
  const name = db.name;
  db.close();
  await Dexie.delete(name);
  db = undefined as unknown as LocalDb;
}

/**
 * Databasen fra før fase 5 hed "traeningsnav" (én bruger, ingen login). Den slettes, når dens
 * udbakke er tom; ellers bevares den urørt, så intet logget går tabt.
 */
export async function removeLegacyDb(): Promise<void> {
  try {
    if (!(await Dexie.exists('traeningsnav'))) return;
    const legacy = new Dexie('traeningsnav');
    await legacy.open();
    const pending = legacy.tables.some((t) => t.name === 'outbox') ? await legacy.table('outbox').count() : 0;
    legacy.close();
    if (pending === 0) await Dexie.delete('traeningsnav');
    else console.warn(`Den gamle lokale database har ${pending} usendte ændringer og bevares.`);
  } catch (e) {
    console.warn('Gammel database', e);
  }
}

export const recordTable = <T extends SyncTable>(name: T) => db.table(name) as Table<RecordTypes[T], string>;

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}
