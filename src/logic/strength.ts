// Fremgang i styrke og reps. Ren logik over øvelseshistorikken (shared/history.ts), så appen og
// trænervisningen regner ens.
//
// Styrke for en vægtøvelse er "beregnet 1RM" (Epley): det bedste sæt, vægt × (1 + reps / 30). Det samler
// vægt og reps i ét tal, så både flere kilo og flere reps på samme vægt tæller som fremgang.
// Kropsvægtsøvelser måles på flest reps i ét sæt, tidsøvelser på det længste sæt.
import type { ExerciseHistoryEntry } from '../../shared/history';
import type { ExerciseKind } from '../../shared/plan.schema';
import type { SetLog } from '../../shared/records.schema';

/** Beregnet 1RM (Epley). Over 20 reps siger formlen ikke meget; de tæller som 20. */
export const epley = (weight: number, reps: number) => (reps <= 1 ? weight : weight * (1 + Math.min(reps, 20) / 30));

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Det bedste sæts beregnede 1RM, eller null uden sæt med både vægt og reps. */
export function bestE1rm(sets: Pick<SetLog, 'weight_kg' | 'reps'>[]): number | null {
  const values = sets.filter((s) => (s.weight_kg ?? 0) > 0 && (s.reps ?? 0) > 0).map((s) => epley(s.weight_kg!, s.reps!));
  return values.length ? round1(Math.max(...values)) : null;
}

/** Flest reps i ét sæt. */
export function bestReps(sets: Pick<SetLog, 'reps'>[]): number | null {
  const reps = sets.map((s) => s.reps).filter((r): r is number => r != null && r > 0);
  return reps.length ? Math.max(...reps) : null;
}

/** Flest reps i et sæt med træningens topvægt ("reps ved topvægt"); uden vægt flest reps i et sæt. */
export function repsAtTop(entry: Pick<ExerciseHistoryEntry, 'sets' | 'topWeight'>): number | null {
  if (entry.topWeight == null) return bestReps(entry.sets);
  return bestReps(entry.sets.filter((s) => s.weight_kg === entry.topWeight));
}

/** Sekunder i alt (tidsøvelser). */
export const totalSeconds = (sets: Pick<SetLog, 'seconds'>[]) => sets.reduce((sum, s) => sum + (s.seconds ?? 0), 0) || null;

export type Measure = 'styrke' | 'reps' | 'tid';

/**
 * Hvad fremgangen måles på for en serie: beregnet 1RM, når de fleste gange har vægt (en vægtøvelse taget
 * uden vægt, fx armstrækninger, måles på reps), ellers reps eller tid efter øvelsens type.
 */
export function measureFor(kind: ExerciseKind, entries: Pick<ExerciseHistoryEntry, 'sets'>[]): Measure {
  if (kind === 'time') return 'tid';
  if (kind === 'weight_reps') {
    const weighted = entries.filter((e) => bestE1rm(e.sets) != null).length;
    if (weighted > 0 && weighted >= entries.length / 2) return 'styrke';
  }
  return 'reps';
}

export const valueFor = (measure: Measure, e: Pick<ExerciseHistoryEntry, 'sets' | 'maxSeconds'>): number | null =>
  measure === 'styrke' ? bestE1rm(e.sets) : measure === 'tid' ? e.maxSeconds : bestReps(e.sets);

export const MEASURE_UNIT: Record<Measure, string> = { styrke: 'kg', reps: 'reps', tid: 'sek' };

export type Trend = 'frem' | 'uændret' | 'tilbage';

export interface Progression {
  exerciseId: string;
  /** Den mulighed der sammenlignes for en "X eller Y"-øvelse (den senest valgte). */
  variant: string | null;
  measure: Measure;
  /** Gange i perioden, ældste først, med målet. */
  points: { key: string; date: string; value: number }[];
  first: ExerciseHistoryEntry;
  last: ExerciseHistoryEntry;
  /** Ændring i målet fra første til seneste gang i perioden, og i procent. */
  change: number;
  changePct: number;
  trend: Trend;
}

/** Under 1 % regnes som uændret (fx 0,5 kg på en tung løft). */
const FLAT = 0.01;

/**
 * Fremgangen for én øvelse fra første til seneste gang i perioden (`from`, tom = hele historikken).
 * `history` er nyeste først (som exerciseHistory). For en "X eller Y"-øvelse sammenlignes kun gange med den
 * senest valgte mulighed, så kabel og håndvægt ikke blandes. Null med færre end to gange.
 */
export function progression(exerciseId: string, kind: ExerciseKind, history: ExerciseHistoryEntry[], from = ''): Progression | null {
  const latest = history[0];
  if (!latest) return null;
  const variant = latest.variant;
  const series = [...history].reverse().filter((e) => e.date >= from && (e.variant ?? null) === (variant ?? null));
  const measure = measureFor(kind, series);
  const points = series
    .map((e) => ({ key: e.workoutUuid, date: e.date, value: valueFor(measure, e), entry: e }))
    .filter((p): p is { key: string; date: string; value: number; entry: ExerciseHistoryEntry } => p.value != null);
  if (points.length < 2) return null;
  const a = points[0];
  const b = points.at(-1)!;
  const change = round1(b.value - a.value);
  const changePct = a.value > 0 ? (b.value - a.value) / a.value : 0;
  return {
    exerciseId,
    variant: variant ?? null,
    measure,
    points: points.map(({ key, date, value }) => ({ key, date, value })),
    first: a.entry,
    last: b.entry,
    change,
    changePct,
    trend: changePct > FLAT ? 'frem' : changePct < -FLAT ? 'tilbage' : 'uændret',
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const mondayOf = (iso: string) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

/**
 * Den typiske fremgang uge for uge, i procent af hver øvelses første gang i perioden: for hver uge
 * medianen over øvelserne af (seneste værdi til og med ugen ÷ første værdi − 1). Medianen, så en enkelt øvelse
 * der er gået fra 2 til 10 kg, ikke trækker hele kurven. Ugerne er mandage, ældste først.
 */
export function weeklyProgress(list: Progression[]): { date: string; value: number; exercises: number }[] {
  if (!list.length) return [];
  const weeks = [...new Set(list.flatMap((p) => p.points.map((x) => mondayOf(x.date))))].sort();
  return weeks
    .map((monday) => {
      const end = new Date(Date.parse(monday + 'T00:00:00Z') + 6 * 86_400_000).toISOString().slice(0, 10);
      const ratios = list
        .map((p) => {
          const upTo = p.points.filter((x) => x.date <= end);
          return upTo.length && p.points[0].value > 0 ? upTo.at(-1)!.value / p.points[0].value - 1 : null;
        })
        .filter((r): r is number => r != null);
      return { date: monday, value: Math.round(median(ratios) * 1000) / 10, exercises: ratios.length };
    })
    .filter((w) => w.exercises > 0);
}
