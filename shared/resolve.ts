// Udleder konkrete øvelser og sætrækker for en session i en given uge.
// Bruges af frontend (logning) og Worker-services (fase 3: getWeek osv.).
import type { Dose, Exercise, NumRange, Plan, PlannedExercise, Session, Side, StrengthSession, Week } from './plan.schema';

const DAY_MS = 86_400_000;

export const inWeeks = (weeks: { from: number; to: number }[], weekNo: number) =>
  weeks.some((r) => weekNo >= r.from && weekNo <= r.to);

/** Ugen der indeholder datoen (YYYY-MM-DD), eller undefined uden for planen. */
export function weekForDate(plan: Plan, date: string): Week | undefined {
  const t = Date.parse(date + 'T00:00:00Z');
  return plan.weeks.find((w) => {
    const start = Date.parse(w.startDate + 'T00:00:00Z');
    return t >= start && t < start + 7 * DAY_MS;
  });
}

/** Datoen for en ugedag (1 = mandag) i en uge. */
export function dateOfDay(week: Week, day: number): string {
  return new Date(Date.parse(week.startDate + 'T00:00:00Z') + (day - 1) * DAY_MS).toISOString().slice(0, 10);
}

export interface SetRow {
  setNo: number;
  side: Side | null;
  reps?: NumRange;
  seconds?: NumRange;
  optional: boolean;
}

/** Sætrækker i udførelsesrækkefølge. Unilaterale øvelser giver én række pr. side pr. sæt. */
export function setRows(exercise: Exercise, dose: Dose): SetRow[] {
  const total = dose.sets + (dose.optionalSets ?? 0);
  if (!exercise.perSide) {
    return Array.from({ length: total }, (_, i) => ({
      setNo: i + 1,
      side: null,
      reps: dose.reps,
      seconds: dose.seconds,
      optional: i >= dose.sets,
    }));
  }
  const order = dose.sideOrder ?? ['H', 'V'];
  const perSide = order.map((side) => {
    const o = dose.sideOverrides?.[side];
    const sets = (o?.sets ?? dose.sets) + (dose.optionalSets ?? 0);
    return Array.from({ length: sets }, (_, i) => ({
      setNo: i + 1,
      side,
      reps: o?.reps ?? dose.reps,
      seconds: o?.seconds ?? dose.seconds,
      optional: i >= (o?.sets ?? dose.sets),
    }));
  });
  if ((dose.sidePattern ?? 'alternate') === 'block') return perSide.flat();
  const rows: SetRow[] = [];
  const max = Math.max(...perSide.map((s) => s.length));
  for (let i = 0; i < max; i++) for (const s of perSide) if (s[i]) rows.push(s[i]);
  return rows;
}

export interface ResolvedExercise {
  exercise: Exercise;
  planned: PlannedExercise;
  label: string;
  rows: SetRow[];
}

export interface ResolvedSlot {
  slotId: string;
  order: number;
  superset: boolean;
  exercises: ResolvedExercise[];
}

export interface ResolvedStrengthSession {
  session: StrengthSession;
  weekNo: number;
  slots: ResolvedSlot[];
}

export function getSession(plan: Plan, sessionId: string): Session | undefined {
  return plan.sessions.find((s) => s.id === sessionId);
}

export function getExercise(plan: Plan, exerciseId: string): Exercise | undefined {
  return plan.exercises.find((e) => e.id === exerciseId);
}

/** Styrkesessionens øvelser i en bestemt uge, i rækkefølge. */
export function resolveStrengthSession(plan: Plan, sessionId: string, weekNo: number): ResolvedStrengthSession {
  const session = getSession(plan, sessionId);
  if (!session || session.kind !== 'styrke') throw new Error(`Ingen styrkesession med id ${sessionId}`);
  const resolve = (pe: PlannedExercise): ResolvedExercise => {
    const exercise = getExercise(plan, pe.exerciseId);
    if (!exercise) throw new Error(`Ukendt øvelse ${pe.exerciseId}`);
    return { exercise, planned: pe, label: pe.label ?? exercise.name, rows: setRows(exercise, pe.dose) };
  };
  const slots = [...session.slots]
    .sort((a, b) => a.order - b.order)
    .flatMap((slot): ResolvedSlot[] => {
      const v = slot.variants.find((x) => inWeeks(x.weeks, weekNo));
      if (!v) return [];
      return [{ slotId: slot.id, order: slot.order, superset: v.exercises.length > 1, exercises: v.exercises.map(resolve) }];
    });
  return { session, weekNo, slots };
}

// ─── Formatering (dansk) ────────────────────────────────────────────────────

export const formatNumber = (n: number) => String(n).replace('.', ',');

export const formatRange = (r: NumRange | undefined, unit = '') =>
  r ? (r.min === r.max ? formatNumber(r.min) : `${formatNumber(r.min)}–${formatNumber(r.max)}`) + unit : '';

/** Fx "3 × 8/ben", "3 × 12 H / 3 × 10 V", "2(+1) × 30 sek". */
export function formatDose(exercise: Exercise, dose: Dose): string {
  const target = (reps?: NumRange, seconds?: NumRange) => (seconds ? formatRange(seconds, ' sek') : formatRange(reps));
  const sets = (n: number) => (dose.optionalSets ? `${n}(+${dose.optionalSets})` : String(n));
  if (exercise.perSide && dose.sideOverrides && Object.keys(dose.sideOverrides).length) {
    return (dose.sideOrder ?? ['H', 'V'])
      .map((side) => {
        const o = dose.sideOverrides?.[side];
        return `${sets(o?.sets ?? dose.sets)} × ${target(o?.reps ?? dose.reps, o?.seconds ?? dose.seconds)} ${side}`;
      })
      .join(' / ');
  }
  return `${sets(dose.sets)} × ${target(dose.reps, dose.seconds)}${exercise.perSide ? '/side' : ''}`;
}

export function formatIntensity(dose: Dose): string {
  const i = dose.intensity;
  if (!i) return '';
  return i.kind === 'rpe' ? `RPE ${formatRange(i)}` : `${formatRange(i)} % 1RM`;
}
