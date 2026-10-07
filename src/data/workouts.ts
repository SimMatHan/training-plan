import { useLiveQuery } from 'dexie-react-hooks';
import type { Session, Side } from '../../shared/plan.schema';
import type { ExerciseNote, MobilityCheck, SetLog, Workout, WorkoutType } from '../../shared/records.schema';
import { todayIso } from '../lib/dates';
import { pickLastTime, type LastTime } from '../logic/lastTime';
import { deterministicUuid } from '../logic/uuid';
import { db } from './db';
import { emptyWorkout, patchRecord, saveRecord, upsertRecord } from './records';

const typeOf = (kind: Session['kind']): WorkoutType => kind;

const alive = <T extends { deleted_at: string | null }>(r: T | undefined): r is T => !!r && !r.deleted_at;

// ─── Træninger ──────────────────────────────────────────────────────────────

const MOBILITY_SESSION = 'mobilitet';

/** Mobilitetsblokken tages dagligt; alle andre sessioner én gang pr. uge. */
const matches = (w: Workout, sessionId: string, today: string) =>
  w.planned_session_id === sessionId && !w.deleted_at && (sessionId !== MOBILITY_SESSION || w.date === today);

/** Starter (eller genåbner) ugens træning for en planlagt session. Datoen er i dag. */
export async function startSession(opts: { session: Session; weekNo: number; planVersion: number }): Promise<string> {
  const today = todayIso();
  const existing = await db.workouts
    .where('week_no')
    .equals(opts.weekNo)
    .filter((w) => matches(w, opts.session.id, today))
    .first();
  if (existing) return existing.uuid;
  const draft = emptyWorkout({
    date: today,
    type: typeOf(opts.session.kind),
    planned_session_id: opts.session.id,
    plan_version: opts.planVersion,
    week_no: opts.weekNo,
  });
  await saveRecord('workouts', draft);
  return draft.uuid;
}

export const patchWorkout = (uuid: string, patch: Partial<Workout>) => patchRecord('workouts', uuid, patch);

export const finishWorkout = (uuid: string) => patchWorkout(uuid, { finished_at: new Date().toISOString() });

export function useWorkout(uuid: string | undefined) {
  return useLiveQuery(async () => (uuid ? ((await db.workouts.get(uuid)) ?? null) : null), [uuid]);
}

/** Ugens træninger (til status pr. session). undefined mens de indlæses. */
export function useWeekWorkouts(weekNo: number | undefined): Workout[] | undefined {
  return useLiveQuery(
    async () => (weekNo ? (await db.workouts.where('week_no').equals(weekNo).toArray()).filter(alive) : []),
    [weekNo],
  );
}

export type SessionStatus = 'ikke-lavet' | 'i-gang' | 'lavet' | 'sprunget-over';

export function statusOf(workouts: Workout[], sessionId: string, today = todayIso()): { status: SessionStatus; workout?: Workout } {
  const workout = workouts.find((w) => matches(w, sessionId, today));
  if (!workout) return { status: 'ikke-lavet' };
  if (workout.skipped_at) return { status: 'sprunget-over', workout };
  return { status: workout.finished_at ? 'lavet' : 'i-gang', workout };
}

/**
 * Markerer en planlagt session som sprunget over, så det logges. Gemmes som en
 * træning uden sæt, dateret til sessionens (evt. flyttede) dag.
 */
export async function skipSession(opts: { session: Session; weekNo: number; planVersion: number; date: string; reason: string | null; note: string | null }) {
  const now = new Date().toISOString();
  await saveRecord(
    'workouts',
    emptyWorkout({
      date: opts.date,
      type: typeOf(opts.session.kind),
      planned_session_id: opts.session.id,
      plan_version: opts.planVersion,
      week_no: opts.weekNo,
      started_at: null,
      skipped_at: now,
      skip_reason: opts.reason,
      note: opts.note,
    }),
  );
}

// ─── Sæt, noter og mobilitet ────────────────────────────────────────────────

export const setUuid = (workoutUuid: string, exerciseId: string, side: Side | null, setNo: number) =>
  deterministicUuid('set', workoutUuid, exerciseId, side, setNo);

export async function upsertSet(
  key: { workoutUuid: string; exerciseId: string; side: Side | null; setNo: number },
  patch: Partial<Pick<SetLog, 'weight_kg' | 'reps' | 'seconds' | 'rpe' | 'done'>>,
) {
  const uuid = await setUuid(key.workoutUuid, key.exerciseId, key.side, key.setNo);
  return upsertRecord(
    'set_logs',
    uuid,
    {
      uuid,
      workout_uuid: key.workoutUuid,
      exercise_id: key.exerciseId,
      set_no: key.setNo,
      side: key.side,
      weight_kg: null,
      reps: null,
      seconds: null,
      rpe: null,
      done: false,
    },
    { ...patch, deleted_at: null },
  );
}

export async function upsertExerciseNote(workoutUuid: string, exerciseId: string, patch: Partial<Pick<ExerciseNote, 'note' | 'rpe'>>) {
  const uuid = await deterministicUuid('note', workoutUuid, exerciseId);
  return upsertRecord('exercise_notes', uuid, { uuid, workout_uuid: workoutUuid, exercise_id: exerciseId, note: null, rpe: null }, patch);
}

export async function setMobilityCheck(workoutUuid: string, itemId: string, done: boolean) {
  const uuid = await deterministicUuid('mobility', workoutUuid, itemId);
  return upsertRecord('mobility_checks', uuid, { uuid, workout_uuid: workoutUuid, item_id: itemId, done }, { done });
}

/** Alt logget i én træning. */
export function useWorkoutLogs(workoutUuid: string | undefined) {
  return useLiveQuery(
    async () => {
      if (!workoutUuid) return { sets: [] as SetLog[], notes: [] as ExerciseNote[], mobility: [] as MobilityCheck[] };
      const [sets, notes, mobility] = await Promise.all([
        db.set_logs.where('workout_uuid').equals(workoutUuid).toArray(),
        db.exercise_notes.where('workout_uuid').equals(workoutUuid).toArray(),
        db.mobility_checks.where('workout_uuid').equals(workoutUuid).toArray(),
      ]);
      return { sets: sets.filter(alive), notes: notes.filter(alive), mobility: mobility.filter(alive) };
    },
    [workoutUuid],
  );
}

/** "Sidste gang" for en øvelse, set fra den aktuelle træning. */
export function useLastTime(exerciseId: string, currentWorkoutUuid: string): LastTime | undefined {
  return useLiveQuery(async () => {
    const current = await db.workouts.get(currentWorkoutUuid);
    if (!current) return undefined;
    const sets = await db.set_logs.where('exercise_id').equals(exerciseId).toArray();
    const workoutIds = [...new Set(sets.map((s) => s.workout_uuid))].filter((id) => id !== currentWorkoutUuid);
    if (!workoutIds.length) return undefined;
    const [workouts, notes] = await Promise.all([
      db.workouts.bulkGet(workoutIds),
      db.exercise_notes.where('exercise_id').equals(exerciseId).toArray(),
    ]);
    return pickLastTime(exerciseId, current, workouts.filter(alive), sets, notes);
  }, [exerciseId, currentWorkoutUuid]);
}

// ─── Aktiviteter uden for planen (padel o.l.) ───────────────────────────────

/** Starter en aktivitet uden for planen. Logges som cardio (tid, puls, evt. distance) med sportens navn. */
export async function startActivity(opts: { name: string; date: string; weekNo: number | null; planVersion: number | null }): Promise<string> {
  const draft = emptyWorkout({
    date: opts.date,
    type: 'cardio',
    activity: opts.name.trim(),
    week_no: opts.weekNo,
    plan_version: opts.planVersion,
  });
  await saveRecord('workouts', draft);
  return draft.uuid;
}

/** Tidligere brugte aktivitetsnavne, mest brugte først (til forslag). */
export function useRecentActivities(): string[] {
  return useLiveQuery(
    async () => {
      const counts = new Map<string, number>();
      for (const w of await db.workouts.toArray()) if (w.activity && !w.deleted_at) counts.set(w.activity, (counts.get(w.activity) ?? 0) + 1);
      return [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    },
    [],
    [],
  );
}
