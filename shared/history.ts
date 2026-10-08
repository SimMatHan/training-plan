// Historik pr. øvelse og pr. uge. Ren logik: appen kalder den med data fra
// IndexedDB, services (og MCP) med data fra D1.
import { worstByWorkout, type PainAssessment, type PainLight } from './pain';
import type { Plan } from './plan.schema';
import type { ExerciseNote, ScheduleOverride, SetLog, Workout } from './records.schema';
import { dateOfDay, getExercise, getSession } from './resolve';
import { effectiveSessions } from './schedule';

const alive = <T extends { deleted_at: string | null }>(r: T) => !r.deleted_at;
const hasValue = (s: SetLog) => s.done || s.reps != null || s.seconds != null || s.weight_kg != null;

/** Sættene der tæller i en træning: de færdige, eller alle med tal hvis intet er markeret færdigt. */
export function countedSets(sets: SetLog[]): SetLog[] {
  const withValues = sets.filter((s) => alive(s) && hasValue(s));
  const done = withValues.filter((s) => s.done);
  return (done.length ? done : withValues).sort((a, b) => a.set_no - b.set_no || (a.side ?? '').localeCompare(b.side ?? ''));
}

export interface ExerciseHistoryEntry {
  workoutUuid: string;
  date: string;
  weekNo: number | null;
  sessionId: string | null;
  sets: SetLog[];
  rpe: number | null;
  note: string | null;
  topWeight: number | null;
  /** Σ vægt × reps (kg). */
  volumeKg: number;
  totalReps: number;
  maxSeconds: number | null;
}

/** Alle gange en øvelse er logget, nyeste først. */
export function exerciseHistory(
  exerciseId: string,
  workouts: Workout[],
  sets: SetLog[],
  notes: ExerciseNote[],
  limit?: number,
): ExerciseHistoryEntry[] {
  const byWorkout = new Map<string, SetLog[]>();
  for (const s of sets) if (s.exercise_id === exerciseId) byWorkout.set(s.workout_uuid, [...(byWorkout.get(s.workout_uuid) ?? []), s]);
  const entries = workouts
    .filter((w) => alive(w) && byWorkout.has(w.uuid))
    .map((w): ExerciseHistoryEntry | null => {
      const counted = countedSets(byWorkout.get(w.uuid)!);
      if (!counted.length) return null;
      const note = notes.find((n) => alive(n) && n.workout_uuid === w.uuid && n.exercise_id === exerciseId);
      const weights = counted.map((s) => s.weight_kg).filter((v): v is number => v != null);
      const seconds = counted.map((s) => s.seconds).filter((v): v is number => v != null);
      return {
        workoutUuid: w.uuid,
        date: w.date,
        weekNo: w.week_no,
        sessionId: w.planned_session_id,
        sets: counted,
        rpe: note?.rpe ?? null,
        note: note?.note || null,
        topWeight: weights.length ? Math.max(...weights) : null,
        volumeKg: Math.round(counted.reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0) * 10) / 10,
        totalReps: counted.reduce((sum, s) => sum + (s.reps ?? 0), 0),
        maxSeconds: seconds.length ? Math.max(...seconds) : null,
      };
    })
    .filter((e): e is ExerciseHistoryEntry => e !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
  return limit ? entries.slice(0, limit) : entries;
}

export type SessionStatus = 'lavet' | 'i-gang' | 'ikke-lavet' | 'sprunget-over';

export interface WeeklySummary {
  weekNo: number;
  startDate: string;
  endDate: string;
  phase: string;
  sessions: {
    sessionId: string;
    name: string;
    /** Faktisk dag (efter evt. flytning). */
    day: number;
    plannedDay: number;
    optional: boolean;
    status: SessionStatus;
    /** Årsag hvis sessionen er markeret som sprunget over. */
    skipReason?: string | null;
    workoutUuid?: string;
    light?: PainLight;
  }[];
  /** Ikke-valgfrie sessioner lavet / planlagt. */
  done: number;
  planned: number;
  /** Ikke-valgfrie sessioner markeret som sprunget over. */
  skipped: number;
  /** Dage med mobilitetsblokken taget alene. */
  mobilityDays: number;
  /** Aktiviteter uden for planen, fx padel. */
  extras: { workoutUuid: string; date: string; name: string; durationSec: number | null; light?: PainLight }[];
  runKm: number;
  volume: { exerciseId: string; name: string; sets: number; reps: number; volumeKg: number }[];
  lights: PainLight[];
}

/** Ugens status: sessioner, løbe-km, trafiklys og volumen pr. øvelse. */
export function weeklySummary(
  plan: Plan,
  weekNo: number,
  workouts: Workout[],
  sets: SetLog[],
  pain: PainAssessment[],
  overrides: ScheduleOverride[] = [],
): WeeklySummary {
  const week = plan.weeks.find((w) => w.weekNo === weekNo);
  if (!week) throw new Error(`Uge ${weekNo} findes ikke i planen`);
  const inWeek = workouts.filter((w) => alive(w) && w.week_no === weekNo);
  // Det værste lys på tværs af monitors pr. træning.
  const lightOf = new Map([...worstByWorkout(pain)].map(([uuid, a]) => [uuid, a.light]));

  const sessions = effectiveSessions(week, overrides).map((s) => {
    const w = inWeek.find((x) => x.planned_session_id === s.sessionId);
    return {
      sessionId: s.sessionId,
      name: getSession(plan, s.sessionId)?.name ?? s.label,
      day: s.day,
      plannedDay: s.plannedDay,
      optional: s.optional,
      status: (w ? (w.skipped_at ? 'sprunget-over' : w.finished_at ? 'lavet' : 'i-gang') : 'ikke-lavet') as SessionStatus,
      ...(w?.skipped_at && { skipReason: w.skip_reason }),
      ...(w && { workoutUuid: w.uuid }),
      ...(w && lightOf.has(w.uuid) && { light: lightOf.get(w.uuid) }),
    };
  });

  const ids = new Set(inWeek.map((w) => w.uuid));
  const volumeMap = new Map<string, { sets: number; reps: number; volumeKg: number }>();
  const byWorkoutExercise = new Map<string, SetLog[]>();
  for (const s of sets) {
    if (!ids.has(s.workout_uuid)) continue;
    const key = `${s.workout_uuid}|${s.exercise_id}`;
    byWorkoutExercise.set(key, [...(byWorkoutExercise.get(key) ?? []), s]);
  }
  for (const [key, list] of byWorkoutExercise) {
    const exerciseId = key.split('|')[1];
    const v = volumeMap.get(exerciseId) ?? { sets: 0, reps: 0, volumeKg: 0 };
    for (const s of countedSets(list)) {
      v.sets++;
      v.reps += s.reps ?? 0;
      v.volumeKg += (s.weight_kg ?? 0) * (s.reps ?? 0);
    }
    volumeMap.set(exerciseId, v);
  }

  return {
    weekNo,
    startDate: week.startDate,
    endDate: dateOfDay(week, 7),
    phase: week.phase,
    sessions,
    done: sessions.filter((s) => !s.optional && s.status === 'lavet').length,
    skipped: sessions.filter((s) => !s.optional && s.status === 'sprunget-over').length,
    planned: sessions.filter((s) => !s.optional).length,
    mobilityDays: new Set(inWeek.filter((w) => w.type === 'mobilitet').map((w) => w.date)).size,
    extras: inWeek
      .filter((w) => !w.planned_session_id)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((w) => ({
        workoutUuid: w.uuid,
        date: w.date,
        name: w.activity ?? 'Anden aktivitet',
        durationSec: w.duration_sec,
        ...(lightOf.has(w.uuid) && { light: lightOf.get(w.uuid) }),
      })),
    runKm: Math.round(inWeek.filter((w) => w.type === 'løb').reduce((sum, w) => sum + (w.distance_km ?? 0), 0) * 100) / 100,
    volume: [...volumeMap]
      .map(([exerciseId, v]) => ({ exerciseId, name: getExercise(plan, exerciseId)?.name ?? exerciseId, ...v, volumeKg: Math.round(v.volumeKg * 10) / 10 }))
      .sort((a, b) => a.name.localeCompare(b.name, 'da')),
    lights: inWeek
      .filter((w) => lightOf.has(w.uuid))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((w) => lightOf.get(w.uuid)!),
  };
}
