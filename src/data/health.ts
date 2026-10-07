// Lyske og ankel: lokale hooks og skrivninger.
import { useLiveQuery } from 'dexie-react-hooks';
import { assessGroin, pendingMorningCheck, type GroinAssessment } from '../../shared/groin';
import { mobilityTrend, type MobilityPoint } from '../../shared/mobility';
import type { Workout } from '../../shared/records.schema';
import { todayIso } from '../lib/dates';
import { deterministicUuid } from '../logic/uuid';
import { db } from './db';
import { newUuid, saveRecord, upsertRecord } from './records';

/** Trafiklys pr. træning, slået op på workout-uuid. */
export function useGroinAssessments(): Map<string, GroinAssessment> {
  const today = todayIso();
  return useLiveQuery(
    async () => {
      const [workouts, checks] = await Promise.all([db.workouts.toArray(), db.groin_checks.toArray()]);
      return new Map(assessGroin(workouts, checks, today).map((a) => [a.workoutUuid, a]));
    },
    [today],
    new Map(),
  );
}

/** Gårsdagens træning, hvis morgenspørgsmålet ikke er besvaret i dag. */
export function usePendingMorningCheck(): Workout | undefined {
  const today = todayIso();
  return useLiveQuery(async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const from = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    const [workouts, checks] = await Promise.all([
      db.workouts.where('date').between(from, today, true, true).toArray(),
      db.groin_checks.where('date').equals(today).toArray(),
    ]);
    return pendingMorningCheck(workouts, checks, today);
  }, [today]);
}

/** Én morgenscore pr. dag (deterministisk uuid), knyttet til gårsdagens træning. */
export async function saveMorningCheck(workoutUuid: string, score: number) {
  const date = todayIso();
  const uuid = await deterministicUuid('groin', date);
  await upsertRecord('groin_checks', uuid, { uuid, date, morning_score: score, workout_uuid: workoutUuid }, { morning_score: score, workout_uuid: workoutUuid });
}

export function useMobilityPoints(): MobilityPoint[] | undefined {
  return useLiveQuery(async () => mobilityTrend(await db.mobility_measurements.toArray()), []);
}

export async function saveMeasurement(m: { date: string; right: number; left: number; note: string | null }) {
  await saveRecord('mobility_measurements', {
    uuid: newUuid(),
    date: m.date,
    knee_to_wall_right_cm: m.right,
    knee_to_wall_left_cm: m.left,
    note: m.note,
  });
}
