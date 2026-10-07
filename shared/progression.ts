// "Klar til mere vægt": alle planlagte sæt ramte toppen af rep-intervallet ved
// RPE ≤ planens mål. Kun et signal — tallene ændres aldrig automatisk.
import type { Dose, Exercise, Plan } from './plan.schema';
import type { SetLog } from './records.schema';
import { getExercise, resolveStrengthSession, setRows } from './resolve';

/** Doseringen en øvelse havde i en given session og uge (også som alternativ). */
export function findPlannedDose(plan: Plan, sessionId: string | null, weekNo: number | null, exerciseId: string): { exercise: Exercise; dose: Dose } | undefined {
  if (!sessionId || !weekNo) return undefined;
  const session = plan.sessions.find((s) => s.id === sessionId);
  if (session?.kind !== 'styrke') return undefined;
  for (const slot of resolveStrengthSession(plan, sessionId, weekNo).slots)
    for (const e of slot.exercises) {
      if (e.exercise.id === exerciseId) return { exercise: e.exercise, dose: e.planned.dose };
      const alt = e.planned.alternative;
      if (alt?.exerciseId === exerciseId) {
        const exercise = getExercise(plan, alt.exerciseId);
        if (exercise) return { exercise, dose: alt.dose };
      }
    }
  return undefined;
}

/**
 * Sand når hver ikke-valgfri planlagt sætrække er færdig med reps ≥ toppen af intervallet,
 * og øvelsens RPE er logget og ≤ planens RPE-mål. Kræver en vægtøvelse med RPE-mål.
 */
export function readyForMoreWeight(exercise: Exercise, dose: Dose, sets: SetLog[], rpe: number | null): boolean {
  if (exercise.kind !== 'weight_reps' || !dose.reps || dose.intensity?.kind !== 'rpe' || rpe == null) return false;
  if (rpe > dose.intensity.max) return false;
  const done = sets.filter((s) => s.done && !s.deleted_at && s.exercise_id === exercise.id);
  const required = setRows(exercise, dose).filter((r) => !r.optional);
  return (
    required.length > 0 &&
    required.every((row) => {
      const s = done.find((x) => x.side === row.side && x.set_no === row.setNo);
      return !!s && s.reps != null && row.reps != null && s.reps >= row.reps.max;
    })
  );
}
