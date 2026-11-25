// Kalenderen og dagsoverblikket fra den lokale database, så de også virker offline.
import { useLiveQuery } from 'dexie-react-hooks';
import type { ExerciseNote, MobilityCheck, MobilityMeasurement, MobilityRoundCheck, PainScore, SetLog } from '../../shared/records.schema';
import { sincePlanStart } from '../../shared/schedule';
import { todayIso } from '../lib/dates';
import { dayEntries, roundsByDate, type DayEntry } from '../logic/calendar';
import { db } from './db';
import { usePlan } from './plan';

const alive = <T extends { deleted_at: string | null }>(r: T) => !r.deleted_at;

export interface MonthData {
  entries: Map<string, DayEntry[]>;
  rounds: ReturnType<typeof roundsByDate>;
}

/** Hvad der står på dagene fra `from` til `to`. undefined mens det indlæses. */
export function useCalendar(from: string, to: string): MonthData | undefined {
  const { active } = usePlan();
  const plan = active?.plan;
  const startedAt = active?.startedAt;
  const today = todayIso();
  return useLiveQuery(async () => {
    const [workouts, overrides, checks] = await Promise.all([
      db.workouts.toArray(),
      db.schedule_overrides.toArray(),
      db.mobility_round_checks.where('date').between(from, to, true, true).toArray(),
    ]);
    // En tidligere plans flytninger har samme ugenumre: kun dem fra efter planen begyndte.
    const live = overrides.filter((o) => alive(o) && sincePlanStart(o.updated_at, startedAt));
    return { entries: dayEntries(plan, workouts, live, from, to, today), rounds: roundsByDate(plan, checks) };
  }, [plan, startedAt, from, to, today]);
}

export interface DayData {
  entries: DayEntry[];
  sets: SetLog[];
  notes: ExerciseNote[];
  mobilityChecks: MobilityCheck[];
  pain: PainScore[];
  roundChecks: MobilityRoundCheck[];
  measurements: MobilityMeasurement[];
}

/** Alt om én dag: sessioner (planlagt og lavet), sæt, noter, smerte, mobilitet og målinger. */
export function useDay(date: string): DayData | undefined {
  const month = useCalendar(date, date);
  const entries = month?.entries.get(date);
  const uuids = (entries ?? []).flatMap((e) => (e.workout ? [e.workout.uuid] : []));
  const key = uuids.join(',');
  const logs = useLiveQuery(async () => {
    const [sets, notes, mobilityChecks, painByWorkout, painOnDate, roundChecks, measurements] = await Promise.all([
      uuids.length ? db.set_logs.where('workout_uuid').anyOf(uuids).toArray() : [],
      uuids.length ? db.exercise_notes.where('workout_uuid').anyOf(uuids).toArray() : [],
      uuids.length ? db.mobility_checks.where('workout_uuid').anyOf(uuids).toArray() : [],
      uuids.length ? db.pain_scores.where('workout_uuid').anyOf(uuids).toArray() : [],
      db.pain_scores.where('date').equals(date).toArray(),
      db.mobility_round_checks.where('date').equals(date).toArray(),
      db.mobility_measurements.where('date').equals(date).toArray(),
    ]);
    // Morgenscorerne for dagens træninger ligger på næste dag; dem på datoen hører til gårsdagens.
    const pain = [...new Map([...painByWorkout, ...painOnDate].filter(alive).map((s) => [s.uuid, s])).values()];
    return {
      sets: sets.filter(alive),
      notes: notes.filter(alive),
      mobilityChecks: mobilityChecks.filter(alive),
      pain,
      roundChecks: roundChecks.filter(alive),
      measurements: measurements.filter(alive),
    };
  }, [date, key]);
  if (!month || !logs) return undefined;
  return { entries: entries ?? [], ...logs };
}
