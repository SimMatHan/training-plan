// Sæt og øvelser ud over planen i én træning. Der gemmes intet nyt: et ekstra sæt er en sætlog
// med et sætnummer over planens, og en ekstra øvelse er en øvelse med sætlogs i træningen, som
// sessionen ikke har i ugen. Tilføjes de, oprettes tomme sætlogs (ikke færdige, uden tal), som
// historikken ikke tæller med, før der er logget noget. Et planlagt sæt, der er fjernet i
// træningen, er en sætlog med skipped.
import type { Dose, Exercise, Plan, Side } from '../../shared/plan.schema';
import type { SetLog } from '../../shared/records.schema';
import { defaultDose } from '../../shared/planEdit';
import { getExercise, setRows, type ResolvedExercise, type ResolvedSlot, type SetRow } from '../../shared/resolve';

/** Siderne et sæt har: begge for sidevise øvelser, ellers ingen. */
export const sidesOf = (exercise: Exercise, dose: Dose): (Side | null)[] => (exercise.perSide ? (dose.sideOrder ?? ['H', 'V']) : [null]);

const maxSetNo = (rows: SetRow[]) => rows.reduce((m, r) => Math.max(m, r.setNo), 0);

/** Planens sætrækker uden dem, der er fjernet i træningen. */
export function keptRows(rows: SetRow[], logs: SetLog[], exerciseId: string): SetRow[] {
  const skipped = new Set(logs.filter((s) => s.exercise_id === exerciseId && s.skipped && !s.deleted_at).map((s) => `${s.side}:${s.set_no}`));
  return rows.filter((r) => !skipped.has(`${r.side}:${r.setNo}`));
}

/** Det laveste sætnummer i planen, der er fjernet i træningen (det "Tilføj sæt" henter tilbage). */
export function firstSkipped(rows: SetRow[], logs: SetLog[], exerciseId: string): number | undefined {
  const kept = new Set(keptRows(rows, logs, exerciseId));
  return rows.find((r) => !kept.has(r))?.setNo;
}

/** Sætrækker for loggede sæt ud over planens, i rækkefølge. */
export function extraSetRows(rows: SetRow[], logs: SetLog[], exercise: Exercise, dose: Dose): SetRow[] {
  const planned = maxSetNo(rows);
  const extra = [...new Set(logs.filter((s) => s.exercise_id === exercise.id && !s.deleted_at && !s.skipped && s.set_no > planned).map((s) => s.set_no))].sort((a, b) => a - b);
  return extra.flatMap((setNo) => sidesOf(exercise, dose).map((side) => ({ setNo, side, reps: dose.reps, seconds: dose.seconds, optional: false, extra: true })));
}

/** Sætnummeret et nyt ekstra sæt får. */
export function nextSetNo(rows: SetRow[], logs: SetLog[], exerciseId: string): number {
  return Math.max(maxSetNo(rows), ...logs.filter((s) => s.exercise_id === exerciseId && !s.deleted_at).map((s) => s.set_no)) + 1;
}

/** Øvelserne der kan logges på sessionens pladser i ugen (også alternativerne). */
export function plannedExerciseIds(slots: ResolvedSlot[]): Set<string> {
  const ids = new Set<string>();
  for (const slot of slots)
    for (const e of slot.exercises) {
      ids.add(e.exercise.id);
      if (e.planned.alternative) ids.add(e.planned.alternative.exerciseId);
    }
  return ids;
}

/** Øvelsen fra planens katalog, eller (er den udgået af planen) gættet ud fra loggen. */
function exerciseFor(plan: Plan, id: string, logs: SetLog[]): Exercise {
  const known = getExercise(plan, id);
  if (known) return known;
  const mine = logs.filter((s) => s.exercise_id === id);
  return {
    id,
    name: id,
    kind: mine.some((s) => s.seconds != null) ? 'time' : mine.some((s) => s.weight_kg != null) ? 'weight_reps' : 'bodyweight_reps',
    perSide: mine.some((s) => s.side != null),
  };
}

/** Prefiks for trin-id'et til en ekstra øvelse i logningen. */
export const EXTRA_STEP = 'ekstra:';

/**
 * Ekstra øvelser i træningen som pladser (én øvelse hver), sorteret efter navn, så trinene står
 * fast mens der logges. Doseringen er den, øvelsen har andre steder i planen.
 */
export function extraSlots(plan: Plan, planned: Set<string>, logs: SetLog[]): ResolvedSlot[] {
  const ids = [...new Set(logs.filter((s) => !s.deleted_at && !planned.has(s.exercise_id)).map((s) => s.exercise_id))];
  return ids
    .map((id) => exerciseFor(plan, id, logs))
    .sort((a, b) => a.name.localeCompare(b.name, 'da'))
    .map((exercise, i) => {
      const dose = defaultDose(plan, exercise);
      const resolved: ResolvedExercise = { exercise, planned: { exerciseId: exercise.id, dose }, label: exercise.name, rows: setRows(exercise, dose) };
      return { slotId: `${EXTRA_STEP}${exercise.id}`, order: 1000 + i, superset: false, exercises: [resolved] };
    });
}
