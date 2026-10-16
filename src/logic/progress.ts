import type { Plan } from '../../shared/plan.schema';
import type { MobilityCheck, SetLog } from '../../shared/records.schema';
import { getExercise, setRows, type ResolvedSlot, type SetRow } from '../../shared/resolve';
import { toRounds } from './rounds';

export interface Progress {
  done: number;
  total: number;
}

export const isComplete = (p: Progress) => p.total > 0 && p.done >= p.total;

/** Øvelsen og sætrækkerne der faktisk logges: alternativets, hvis det er logget. */
function inUse(plan: Plan, ex: ResolvedSlot['exercises'][number], sets: SetLog[]) {
  const alt = ex.planned.alternative;
  const altExercise = alt && getExercise(plan, alt.exerciseId);
  const useAlt = !!alt && !!altExercise && sets.some((s) => s.exercise_id === alt.exerciseId && !s.deleted_at);
  return { exercise: useAlt ? altExercise! : ex.exercise, rows: useAlt ? setRows(altExercise!, alt!.dose) : ex.rows };
}

const isDone = (sets: SetLog[], exerciseId: string, r: SetRow) =>
  sets.some((s) => s.exercise_id === exerciseId && s.side === r.side && s.set_no === r.setNo && s.done && !s.deleted_at);

/**
 * Færdige ikke-valgfrie sætrækker på en plads (begge øvelser i et superset).
 * Er alternativ-øvelsen logget, tælles dens rækker i stedet.
 */
export function slotProgress(plan: Plan, slot: ResolvedSlot, sets: SetLog[]): Progress {
  let done = 0;
  let total = 0;
  for (const ex of slot.exercises) {
    const { exercise, rows } = inUse(plan, ex, sets);
    const required = rows.filter((r) => !r.optional);
    total += required.length;
    done += required.filter((r) => isDone(sets, exercise.id, r)).length;
  }
  return { done, total };
}

/** Som slotProgress, men pr. sæt: højre og venstre i samme sæt tæller som ét, som i oversigten. */
export function slotSetProgress(plan: Plan, slot: ResolvedSlot, sets: SetLog[]): Progress {
  let done = 0;
  let total = 0;
  for (const ex of slot.exercises) {
    const { exercise, rows } = inUse(plan, ex, sets);
    const rounds = toRounds(rows).filter((r) => !r.optional);
    total += rounds.length;
    done += rounds.filter((r) => r.rows.every((row) => isDone(sets, exercise.id, row))).length;
  }
  return { done, total };
}

export function mobilityProgress(plan: Plan, checks: MobilityCheck[]): Progress {
  const done = new Set(checks.filter((c) => c.done && !c.deleted_at).map((c) => c.item_id));
  const items = plan.mobility?.items ?? [];
  return { done: items.filter((i) => done.has(i.id)).length, total: items.length };
}

/** Næste ufærdige sektion efter `after` (eller fra starten), eller null. */
export function nextIncomplete(order: string[], progress: Record<string, Progress>, after?: string): string | null {
  const start = after ? order.indexOf(after) + 1 : 0;
  return order.slice(start).find((id) => !isComplete(progress[id])) ?? null;
}

/** Hvor en planlagt dag ligger i forhold til i dag (begge 'YYYY-MM-DD'). */
export const dayState = (date: string, today: string): 'past' | 'today' | 'future' => (date < today ? 'past' : date === today ? 'today' : 'future');
