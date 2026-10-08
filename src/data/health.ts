// Smerte (pr. monitor) og mobilitetstests: lokale hooks og skrivninger.
import { useLiveQuery } from 'dexie-react-hooks';
import type { MobilityTest } from '../../shared/athletes';
import { mobilityTrend, type MobilityPoint } from '../../shared/mobility';
import { assessAllPain, pendingMorningChecks, worstByWorkout, type PainAssessment } from '../../shared/pain';
import type { PainScore, Workout } from '../../shared/records.schema';
import { todayIso } from '../lib/dates';
import { deterministicUuid } from '../logic/uuid';
import { db } from './db';
import { useMonitors } from './plan';
import { newUuid, saveRecord, upsertRecord } from './records';

/** Alle vurderinger for de aktive monitors. */
export function usePainAssessments(): PainAssessment[] {
  const today = todayIso();
  const ids = useMonitors().map((m) => m.id);
  const key = ids.join(',');
  return useLiveQuery(
    async () => {
      const [workouts, scores] = await Promise.all([db.workouts.toArray(), db.pain_scores.toArray()]);
      return assessAllPain(workouts, scores, ids, today);
    },
    [today, key],
    [],
  );
}

/** Det værste trafiklys pr. træning på tværs af monitors, slået op på workout-uuid. */
export function useWorstLights(): Map<string, PainAssessment> {
  return worstByWorkout(usePainAssessments());
}

/** Morgenspørgsmålene i dag: én pr. monitor med en træning i går. */
export function usePendingMorningChecks(): { monitorId: number; workout: Workout }[] {
  const today = todayIso();
  const ids = useMonitors().map((m) => m.id);
  const key = ids.join(',');
  return useLiveQuery(
    async () => {
      const yesterday = new Date(Date.now() - 86_400_000);
      const from = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      const [workouts, scores] = await Promise.all([db.workouts.where('date').between(from, today, true, true).toArray(), db.pain_scores.toArray()]);
      return pendingMorningChecks(workouts, scores, ids, today);
    },
    [today, key],
    [],
  );
}

/** Morgenscoren for én monitor i dag (én pr. dag og monitor), knyttet til gårsdagens træning. */
export async function saveMorningScore(monitorId: number, workoutUuid: string, score: number) {
  const date = todayIso();
  const uuid = await deterministicUuid('smerte-morgen', date, monitorId);
  await upsertRecord('pain_scores', uuid, { uuid, monitor_id: monitorId, workout_uuid: workoutUuid, date, kind: 'morgen', score }, { score, workout_uuid: workoutUuid });
}

/** Under-scorerne for en træning (alle monitors). */
export function useDuringScores(workoutUuid: string | undefined): PainScore[] {
  return useLiveQuery(
    async () => (workoutUuid ? (await db.pain_scores.where('workout_uuid').equals(workoutUuid).toArray()).filter((s) => s.kind === 'under' && !s.deleted_at) : []),
    [workoutUuid],
    [],
  );
}

/**
 * Gemmer under-scoren for en træning og monitor. Findes der allerede en (også en flyttet fra
 * fase 1's lyske-felt), rettes den; ellers oprettes en med deterministisk uuid.
 */
export async function saveDuringScore(workout: Pick<Workout, 'uuid' | 'date'>, monitorId: number, score: number) {
  const existing = (await db.pain_scores.where('workout_uuid').equals(workout.uuid).toArray()).find((s) => s.kind === 'under' && s.monitor_id === monitorId);
  const uuid = existing?.uuid ?? (await deterministicUuid('smerte', workout.uuid, monitorId));
  await upsertRecord(
    'pain_scores',
    uuid,
    { uuid, monitor_id: monitorId, workout_uuid: workout.uuid, date: workout.date, kind: 'under', score },
    { score, date: workout.date, deleted_at: null },
  );
}

/** Målingerne for hver af testene, ældste først. */
export function useMobilityTrends(tests: MobilityTest[]): { test: MobilityTest; points: MobilityPoint[] }[] | undefined {
  const key = tests.map((t) => `${t.id}:${t.per_side}`).join(',');
  return useLiveQuery(async () => {
    const all = await db.mobility_measurements.toArray();
    return tests.map((test) => ({ test, points: mobilityTrend(all, test) }));
  }, [key]);
}

export async function saveMeasurement(m: { testId: number; date: string; right: number | null; left: number | null; value: number | null; note: string | null }) {
  await saveRecord('mobility_measurements', {
    uuid: newUuid(),
    test_id: m.testId,
    date: m.date,
    value_right: m.right,
    value_left: m.left,
    value: m.value,
    note: m.note,
  });
}
