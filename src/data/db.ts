// Lokal database (IndexedDB via Dexie). Alt logges her først; udbakken
// (outbox) holder styr på hvad der mangler at blive sendt til D1.
import Dexie, { type Table } from 'dexie';
import type {
  ExerciseNote,
  GroinCheck,
  MobilityCheck,
  MobilityMeasurement,
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
  queuedAt: string;
}

export interface RecordTypes {
  workouts: Workout;
  set_logs: SetLog;
  exercise_notes: ExerciseNote;
  groin_checks: GroinCheck;
  mobility_measurements: MobilityMeasurement;
  mobility_checks: MobilityCheck;
}

class LocalDb extends Dexie {
  kv!: Table<KvRow, string>;
  outbox!: Table<OutboxRow, string>;
  workouts!: Table<Workout, string>;
  set_logs!: Table<SetLog, string>;
  exercise_notes!: Table<ExerciseNote, string>;
  groin_checks!: Table<GroinCheck, string>;
  mobility_measurements!: Table<MobilityMeasurement, string>;
  mobility_checks!: Table<MobilityCheck, string>;

  constructor() {
    super('traeningsnav');
    this.version(1).stores({ kv: 'key' });
    this.version(2).stores({
      outbox: 'key, queuedAt',
      workouts: 'uuid, date, week_no, planned_session_id',
      set_logs: 'uuid, workout_uuid, exercise_id',
      exercise_notes: 'uuid, workout_uuid, exercise_id',
      groin_checks: 'uuid, date, workout_uuid',
      mobility_measurements: 'uuid, date',
      mobility_checks: 'uuid, workout_uuid',
    });
  }

}

export const db = new LocalDb();

export const recordTable = <T extends SyncTable>(name: T) => db.table(name) as Table<RecordTypes[T], string>;

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}
