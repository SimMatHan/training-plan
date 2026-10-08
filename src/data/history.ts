// Historik fra den lokale database, så den også virker offline.
import { useLiveQuery } from 'dexie-react-hooks';
import { assessAllPain } from '../../shared/pain';
import { exerciseHistory, weeklySummary, type ExerciseHistoryEntry, type WeeklySummary } from '../../shared/history';
import type { Plan } from '../../shared/plan.schema';
import { todayIso } from '../lib/dates';
import { db } from './db';
import { useMonitors } from './plan';

/** Samme form som serverens /history/exercises (trænervisningen). */
export interface ExerciseOverview {
  exerciseId: string;
  times: number;
  last: ExerciseHistoryEntry;
}

/** Alle øvelser med historik, senest trænede først. */
export function useExerciseOverview(): ExerciseOverview[] | undefined {
  return useLiveQuery(async () => {
    const [workouts, sets, notes] = await Promise.all([db.workouts.toArray(), db.set_logs.toArray(), db.exercise_notes.toArray()]);
    const ids = [...new Set(sets.filter((s) => !s.deleted_at).map((s) => s.exercise_id))];
    return ids
      .map((id) => {
        const entries = exerciseHistory(id, workouts, sets, notes);
        return entries.length ? { exerciseId: id, times: entries.length, last: entries[0] } : null;
      })
      .filter((o): o is ExerciseOverview => o !== null)
      .sort((a, b) => b.last.date.localeCompare(a.last.date));
  }, []);
}

export function useExerciseHistory(exerciseId: string): ExerciseHistoryEntry[] | undefined {
  return useLiveQuery(async () => {
    const sets = await db.set_logs.where('exercise_id').equals(exerciseId).toArray();
    const ids = [...new Set(sets.map((s) => s.workout_uuid))];
    const [workouts, notes] = await Promise.all([db.workouts.bulkGet(ids), db.exercise_notes.where('exercise_id').equals(exerciseId).toArray()]);
    return exerciseHistory(exerciseId, workouts.filter((w) => !!w), sets, notes);
  }, [exerciseId]);
}

/** Opsummering af planens uger op til og med `untilWeek`, nyeste først. */
export function useWeeklySummaries(plan: Plan | undefined, untilWeek: number): WeeklySummary[] | undefined {
  const today = todayIso();
  const ids = useMonitors().map((m) => m.id);
  const key = ids.join(',');
  return useLiveQuery(async () => {
    if (!plan) return undefined;
    const [workouts, sets, scores, overrides] = await Promise.all([
      db.workouts.toArray(),
      db.set_logs.toArray(),
      db.pain_scores.toArray(),
      db.schedule_overrides.toArray(),
    ]);
    const groin = assessAllPain(workouts, scores, ids, today);
    return plan.weeks
      .filter((w) => w.weekNo <= untilWeek)
      .map((w) => weeklySummary(plan, w.weekNo, workouts, sets, groin, overrides))
      .reverse();
  }, [plan, untilWeek, today, key]);
}
