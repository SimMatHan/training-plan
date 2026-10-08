// Værdier til talhjulene i logningen.
import type { Exercise } from '../../shared/plan.schema';
import type { SetLog } from '../../shared/records.schema';

// Øvelser med stang, kabel eller maskine går i trin af 2,5 kg; resten (håndvægte) i 0,5 kg.
const BAR = /stang|barbell|kabel|maskine|pulldown|pushdown|face pull|pallof|t-bar|^hip thrust|rumænsk dødløft|bænkpres/i;

/** Vægttrin for en øvelse i kg. */
export const weightStep = (exercise: Pick<Exercise, 'name'>) => (BAR.test(exercise.name) ? 2.5 : 0.5);

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Hjulets værdier fra `min` op til et loft der altid ligger et godt stykke over den aktuelle
 * værdi. En værdi uden for trinnene (fx 13,75 kg i 2,5-trin) sættes ind på sin plads.
 */
export function wheelValues({ value, step, min = 0, floor = 40, headroom = 2 }: { value: number | null; step: number; min?: number; floor?: number; headroom?: number }): number[] {
  const top = Math.max(floor, (value ?? 0) * headroom, (value ?? 0) + 10 * step);
  const values: number[] = [];
  for (let v = min; v <= top + 1e-9; v += step) values.push(round(v));
  if (value != null && !values.some((v) => Math.abs(v - value) < 1e-9)) {
    values.push(value);
    values.sort((a, b) => a - b);
  }
  return values;
}

/** Index for en værdi i hjulet (nærmeste, hvis den ikke findes). */
export function nearestIndex(values: readonly (number | null)[], value: number | null): number {
  if (value == null) return Math.max(0, values.indexOf(null));
  let best = 0;
  values.forEach((v, i) => {
    if (v != null && (values[best] == null || Math.abs(v - value) < Math.abs((values[best] as number) - value))) best = i;
  });
  return best;
}

/** Score til rekorder: vægt × reps, ellers reps, ellers sekunder. */
export function setScore(s: Pick<SetLog, 'weight_kg' | 'reps' | 'seconds'>, kind: Exercise['kind']): number {
  if (kind === 'time') return s.seconds ?? 0;
  if (kind === 'bodyweight_reps') return s.reps ?? 0;
  return (s.weight_kg ?? 0) * (s.reps ?? 0);
}

/** Bedste score i en række sæt, eller null uden sæt. */
export function bestScore(sets: Pick<SetLog, 'weight_kg' | 'reps' | 'seconds'>[], kind: Exercise['kind']): number | null {
  return sets.length ? Math.max(...sets.map((s) => setScore(s, kind))) : null;
}
