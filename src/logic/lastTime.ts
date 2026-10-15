// "Sidste gang": sættene fra den seneste træning med øvelsen.
import type { ExerciseKind, Side } from '../../shared/plan.schema';
import type { ExerciseNote, SetLog, Workout } from '../../shared/records.schema';
import { formatDecimal } from './numbers';

export interface LastTime {
  workout: Workout;
  sets: SetLog[];
  rpe: number | null;
  note: string | null;
}

const hasValue = (s: SetLog) => s.done || s.reps != null || s.seconds != null || s.weight_kg != null;

/** Seneste træning før (eller samme dag som) den aktuelle, hvor øvelsen blev logget. */
export function pickLastTime(
  exerciseId: string,
  current: { uuid: string; date: string },
  workouts: Workout[],
  setLogs: SetLog[],
  notes: ExerciseNote[],
): LastTime | undefined {
  const byWorkout = new Map<string, SetLog[]>();
  for (const s of setLogs) {
    if (s.exercise_id !== exerciseId || s.deleted_at || s.workout_uuid === current.uuid || !hasValue(s)) continue;
    byWorkout.set(s.workout_uuid, [...(byWorkout.get(s.workout_uuid) ?? []), s]);
  }
  const candidates = workouts
    .filter((w) => !w.deleted_at && byWorkout.has(w.uuid) && w.date <= current.date)
    .sort((a, b) => (a.date === b.date ? (b.started_at ?? '').localeCompare(a.started_at ?? '') : b.date.localeCompare(a.date)));
  const workout = candidates[0];
  if (!workout) return undefined;
  const done = byWorkout.get(workout.uuid)!;
  const sets = (done.some((s) => s.done) ? done.filter((s) => s.done) : done).sort(
    (a, b) => a.set_no - b.set_no || (a.side ?? '').localeCompare(b.side ?? ''),
  );
  const note = notes.find((n) => n.workout_uuid === workout.uuid && n.exercise_id === exerciseId && !n.deleted_at);
  return { workout, sets, rpe: note?.rpe ?? null, note: note?.note || null };
}

export interface Ghost {
  weight_kg: number | null;
  reps: number | null;
  seconds: number | null;
}

/** Spøgelsestal til et sæt: samme sætnummer og side sidst, ellers sidste sæt på siden. */
export function ghostFor(last: LastTime | undefined, side: Side | null, setNo: number): Ghost | undefined {
  if (!last) return undefined;
  const sameSide = last.sets.filter((s) => s.side === side);
  const s = sameSide.find((x) => x.set_no === setNo) ?? sameSide.at(-1);
  return s && { weight_kg: s.weight_kg, reps: s.reps, seconds: s.seconds };
}

/** "50 kg × 8", "8 reps" eller "30 sek". */
function formatSet(s: SetLog, kind: ExerciseKind): string {
  if (kind === 'time') return `${s.seconds ?? '?'} sek`;
  return s.weight_kg ? `${formatDecimal(s.weight_kg)} kg × ${s.reps ?? '?'}` : `${s.reps ?? '?'} reps`;
}

/**
 * Hvad sættet var sidst, til at sammenligne med i dag: kun samme sætnummer (ingen fallback som
 * ghostFor). En runde med begge sider giver "12 kg × 8", eller "H 12 kg × 8 / V 12 kg × 7" hvis
 * siderne var forskellige.
 */
export function previousSet(last: LastTime | undefined, sides: (Side | null)[], setNo: number, kind: ExerciseKind): string | undefined {
  if (!last) return undefined;
  const per = sides
    .map((side) => ({ side, set: last.sets.find((s) => s.side === side && s.set_no === setNo) }))
    .filter((p): p is { side: Side | null; set: SetLog } => !!p.set)
    .map((p) => ({ side: p.side, text: formatSet(p.set, kind) }));
  if (!per.length) return undefined;
  if (per.every((p) => p.text === per[0].text)) return per[0].text;
  return per.map((p) => `${p.side} ${p.text}`).join(' / ');
}

function describe(sets: SetLog[], kind: ExerciseKind): string {
  const groups: { n: number; key: string }[] = [];
  for (const s of sets) {
    const amount = kind === 'time' ? `${s.seconds ?? '?'} sek` : `${s.reps ?? '?'}`;
    const key = s.weight_kg ? `${amount} @ ${formatDecimal(s.weight_kg)} kg` : amount;
    const last = groups.at(-1);
    if (last && last.key === key) last.n++;
    else groups.push({ n: 1, key });
  }
  return groups.map((g) => `${g.n} × ${g.key}`).join(', ');
}

/** "3 × 8 @ 12,5 kg", "3 × 8/side @ 10 kg" eller "H 3 × 12 · V 3 × 10". */
export function summarizeSets(sets: SetLog[], kind: ExerciseKind): string {
  const sides = [...new Set(sets.map((s) => s.side))];
  if (sides.length <= 1 || sides.includes(null)) return describe(sets, kind);
  const per = sides.map((side) => ({ side, text: describe(sets.filter((s) => s.side === side), kind) }));
  if (per.every((p) => p.text === per[0].text)) return per[0].text.replace(/^(\d+ × [^ ,@]+(?: sek)?)/, '$1/side');
  return per.map((p) => `${p.side} ${p.text}`).join(' · ');
}
