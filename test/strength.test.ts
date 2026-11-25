// Fremgang i styrke og reps (src/logic/strength.ts).
import { describe, expect, it } from 'vitest';
import type { ExerciseHistoryEntry } from '../shared/history';
import type { SetLog } from '../shared/records.schema';
import { bestE1rm, bestReps, epley, measureFor, progression, repsAtTop, weeklyProgress } from '../src/logic/strength';

let n = 0;
const set = (weight_kg: number | null, reps: number | null, seconds: number | null = null): SetLog => ({
  uuid: `70000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  updated_at: '2026-10-07T10:00:00.000Z',
  deleted_at: null,
  workout_uuid: '70000000-0000-4000-8000-000000000000',
  exercise_id: 'x',
  set_no: 1,
  side: null,
  weight_kg,
  reps,
  seconds,
  rpe: null,
  done: true,
});

const entry = (date: string, sets: SetLog[], variant: string | null = null): ExerciseHistoryEntry => {
  const weights = sets.map((s) => s.weight_kg).filter((v): v is number => v != null);
  const secs = sets.map((s) => s.seconds).filter((v): v is number => v != null);
  return {
    workoutUuid: `w-${date}-${variant}`,
    date,
    weekNo: null,
    sessionId: null,
    sets,
    rpe: null,
    note: null,
    variant,
    topWeight: weights.length ? Math.max(...weights) : null,
    volumeKg: sets.reduce((s, x) => s + (x.weight_kg ?? 0) * (x.reps ?? 0), 0),
    totalReps: sets.reduce((s, x) => s + (x.reps ?? 0), 0),
    maxSeconds: secs.length ? Math.max(...secs) : null,
  };
};
/** Nyeste først, som exerciseHistory. */
const history = (...entries: ExerciseHistoryEntry[]) => [...entries].sort((a, b) => b.date.localeCompare(a.date));

describe('styrke og reps pr. gang', () => {
  it('beregner 1RM med Epley ud fra det bedste sæt', () => {
    expect(epley(100, 1)).toBe(100);
    expect(epley(60, 10)).toBe(80);
    expect(epley(10, 40)).toBeCloseTo(10 * (1 + 20 / 30));
    expect(bestE1rm([set(60, 10), set(70, 5), set(null, 12)])).toBe(81.7);
    expect(bestE1rm([set(null, 12)])).toBeNull();
  });

  it('finder reps i bedste sæt og ved topvægt', () => {
    expect(bestReps([set(20, 8), set(18, 10)])).toBe(10);
    expect(repsAtTop(entry('2026-10-01', [set(20, 8), set(20, 7), set(18, 10)]))).toBe(8);
    expect(repsAtTop(entry('2026-10-01', [set(null, 12), set(null, 9)]))).toBe(12);
  });

  it('måler en vægtøvelse uden vægt (fx armstrækninger) på reps', () => {
    expect(measureFor('weight_reps', [entry('2026-10-01', [set(20, 8)])])).toBe('styrke');
    expect(measureFor('weight_reps', [entry('2026-10-01', [set(null, 15)]), entry('2026-10-02', [set(null, 16)])])).toBe('reps');
    expect(measureFor('bodyweight_reps', [entry('2026-10-01', [set(null, 8)])])).toBe('reps');
    expect(measureFor('time', [entry('2026-10-01', [set(null, null, 30)])])).toBe('tid');
  });
});

describe('fremgang pr. øvelse', () => {
  it('tæller flere reps på samme vægt som fremgang', () => {
    const p = progression('hip-thrust', 'weight_reps', history(entry('2026-10-01', [set(60, 8)]), entry('2026-10-08', [set(60, 10)])))!;
    expect(p.measure).toBe('styrke');
    expect(p.trend).toBe('frem');
    expect(p.points.map((x) => x.value)).toEqual([76, 80]);
    expect(p.change).toBe(4);
  });

  it('sammenligner kun den senest valgte mulighed for en "X eller Y"-øvelse', () => {
    const h = history(
      entry('2026-10-01', [set(40, 10)], 'Kabelrows'),
      entry('2026-10-05', [set(16, 10)], 'Håndvægtsrows'),
      entry('2026-10-12', [set(18, 10)], 'Håndvægtsrows'),
    );
    const p = progression('rows', 'weight_reps', h)!;
    expect(p.variant).toBe('Håndvægtsrows');
    expect(p.points).toHaveLength(2);
    expect(p.first.topWeight).toBe(16);
    expect(p.trend).toBe('frem');
  });

  it('er uændret under 1 %, går tilbage over, og kræver to gange i perioden', () => {
    const flat = progression('x', 'bodyweight_reps', history(entry('2026-10-01', [set(null, 8)]), entry('2026-10-08', [set(null, 8)])))!;
    expect(flat.trend).toBe('uændret');
    const down = progression('x', 'time', history(entry('2026-10-01', [set(null, null, 40)]), entry('2026-10-08', [set(null, null, 30)])))!;
    expect(down.trend).toBe('tilbage');
    expect(down.changePct).toBeCloseTo(-0.25);
    const h = history(entry('2026-09-01', [set(10, 8)]), entry('2026-10-08', [set(12, 8)]));
    expect(progression('x', 'weight_reps', h, '2026-10-01')).toBeNull();
    expect(progression('x', 'weight_reps', [])).toBeNull();
  });

  it('giver den typiske fremgang uge for uge som median', () => {
    const a = progression('a', 'weight_reps', history(entry('2026-10-05', [set(50, 10)]), entry('2026-10-12', [set(55, 10)]), entry('2026-10-19', [set(60, 10)])))!;
    const b = progression('b', 'bodyweight_reps', history(entry('2026-10-06', [set(null, 10)]), entry('2026-10-20', [set(null, 12)])))!;
    // Uden medianen ville en øvelse fra 2 til 10 kg trække kurven op.
    const c = progression('c', 'weight_reps', history(entry('2026-10-07', [set(2, 10)]), entry('2026-10-21', [set(10, 10)])))!;
    expect(weeklyProgress([a, b, c])).toEqual([
      { date: '2026-10-05', value: 0, exercises: 3 },
      { date: '2026-10-12', value: 0, exercises: 3 },
      { date: '2026-10-19', value: 20, exercises: 3 },
    ]);
    expect(weeklyProgress([])).toEqual([]);
  });
});
