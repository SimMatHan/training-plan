// Logdata. Ét skema pr. D1-tabel. Alle poster har uuid (genereret på klienten)
// og updated_at; sync er last-write-wins pr. post. Sletning sker som tombstone
// (deleted_at), så sletninger også synker.
import { z } from 'zod';
import { IsoDate, Side, Slug } from './plan.schema';
import type { SYNC_TABLES } from './tables';

/** ISO 8601 i UTC med millisekunder, fx 2026-10-05T17:03:12.345Z. Sammenlignes som tekst. */
export const IsoTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'Tidsstempel skal være ISO UTC med ms');

const Score = z.int().min(0).max(10);
const Rpe = z.number().min(1).max(10).multipleOf(0.5);

const SyncFields = {
  uuid: z.uuid(),
  updated_at: IsoTimestamp,
  deleted_at: IsoTimestamp.nullable().default(null),
};

export const WorkoutType = z.enum(['styrke', 'løb', 'cardio', 'mobilitet']);
export type WorkoutType = z.infer<typeof WorkoutType>;

export const WorkoutSource = z.enum(['app', 'strava']);

export const Workout = z.object({
  ...SyncFields,
  /** Sessions-id fra planen (fx "styrke-a", "t1"). Null for en ikke-planlagt træning. */
  planned_session_id: Slug.nullable(),
  plan_version: z.int().min(1).nullable(),
  week_no: z.int().min(1).nullable(),
  date: IsoDate,
  started_at: IsoTimestamp.nullable(),
  finished_at: IsoTimestamp.nullable(),
  type: WorkoutType,
  rpe: Rpe.nullable(),
  note: z.string().nullable(),
  /** Smerte i venstre lyske under træning, 0–10. */
  groin_during: Score.nullable(),
  source: WorkoutSource,
  external_id: z.string().nullable(),
  // Løb og cardio
  distance_km: z.number().nonnegative().nullable(),
  duration_sec: z.int().nonnegative().nullable(),
  avg_hr: z.int().min(30).max(250).nullable(),
  /** Sport for en træning uden for planen, fx "Padel". Null for planens sessioner. */
  activity: z.string().trim().min(1).max(40).nullable().default(null),
  /** Sat når en planlagt session er markeret som sprunget over. */
  skipped_at: IsoTimestamp.nullable().default(null),
  /** Kort årsag til at sessionen blev sprunget over, fx "Lyske/smerte". */
  skip_reason: z.string().trim().min(1).max(60).nullable().default(null),
});
export type Workout = z.infer<typeof Workout>;

export const SetLog = z.object({
  ...SyncFields,
  workout_uuid: z.uuid(),
  exercise_id: Slug,
  set_no: z.int().min(1),
  side: Side.nullable(),
  weight_kg: z.number().nonnegative().nullable(),
  reps: z.int().nonnegative().nullable(),
  seconds: z.int().nonnegative().nullable(),
  rpe: Rpe.nullable(),
  done: z.boolean(),
});
export type SetLog = z.infer<typeof SetLog>;

/** Note og RPE pr. øvelse pr. træning. */
export const ExerciseNote = z.object({
  ...SyncFields,
  workout_uuid: z.uuid(),
  exercise_id: Slug,
  note: z.string().nullable(),
  rpe: Rpe.nullable(),
});
export type ExerciseNote = z.infer<typeof ExerciseNote>;

/** Morgenspørgsmålet: "Hvordan er lysken i morges?" */
export const GroinCheck = z.object({
  ...SyncFields,
  /** Morgenens dato. */
  date: IsoDate,
  morning_score: Score,
  /** Træningen dagen før, som scoren hører til. */
  workout_uuid: z.uuid().nullable(),
});
export type GroinCheck = z.infer<typeof GroinCheck>;

export const MobilityMeasurement = z.object({
  ...SyncFields,
  date: IsoDate,
  knee_to_wall_right_cm: z.number().min(0).max(30).nullable(),
  knee_to_wall_left_cm: z.number().min(0).max(30).nullable(),
  note: z.string().nullable(),
});
export type MobilityMeasurement = z.infer<typeof MobilityMeasurement>;

export const MobilityCheck = z.object({
  ...SyncFields,
  workout_uuid: z.uuid(),
  item_id: Slug,
  done: z.boolean(),
});
export type MobilityCheck = z.infer<typeof MobilityCheck>;

/** En planlagt session flyttet til en anden dag i samme uge. Tombstone = tilbage til planens dag. */
export const ScheduleOverride = z.object({
  ...SyncFields,
  week_no: z.int().min(1),
  session_id: Slug,
  /** 1 = mandag … 7 = søndag. */
  day: z.int().min(1).max(7),
});
export type ScheduleOverride = z.infer<typeof ScheduleOverride>;

/** Synkroniserede tabeller og deres skemaer. Fase 2–4 tilføjer, men ændrer ikke. */
export const SyncTables = {
  workouts: Workout,
  set_logs: SetLog,
  exercise_notes: ExerciseNote,
  groin_checks: GroinCheck,
  mobility_measurements: MobilityMeasurement,
  mobility_checks: MobilityCheck,
  schedule_overrides: ScheduleOverride,
} as const;
export type SyncTable = keyof typeof SyncTables;

// SYNC_TABLES (uden zod, til frontenden) skal indeholde præcis de samme tabeller.
type _SameTables = [SyncTable] extends [(typeof SYNC_TABLES)[number]]
  ? [(typeof SYNC_TABLES)[number]] extends [SyncTable]
    ? true
    : never
  : never;
export const _syncTablesMatch: _SameTables = true;

export const PlanVersionSource = z.enum(['seed', 'manual', 'claude']);

export const PlanVersionMeta = z.object({
  id: z.int(),
  version: z.int().min(1),
  created_at: IsoTimestamp,
  source: PlanVersionSource,
  note: z.string().nullable(),
  based_on_version: z.int().nullable(),
  is_active: z.boolean(),
});
export type PlanVersionMeta = z.infer<typeof PlanVersionMeta>;
