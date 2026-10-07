import { describe, expect, it } from 'vitest';
import planJson from '../plan/plan.v1.json';
import { PlanSchema } from '../shared/plan.schema';
import type { SetLog, Workout } from '../shared/records.schema';
import { resolveStrengthSession } from '../shared/resolve';
import { ghostFor, pickLastTime, summarizeSets } from '../src/logic/lastTime';
import { formatDecimal, parseDecimal, sanitizeDecimal } from '../src/logic/numbers';
import { restAfter } from '../src/logic/rest';
import { deterministicUuid } from '../src/logic/uuid';
import { dayState, nextIncomplete, slotProgress } from '../src/logic/progress';
import { Workout as WorkoutSchema } from '../shared/records.schema';

const plan = PlanSchema.parse(planJson);
const ts = '2026-10-05T16:00:00.000Z';

const workout = (uuid: string, date: string): Workout =>
  WorkoutSchema.parse({
    uuid,
    planned_session_id: 'rehab-a',
    plan_version: 1,
    week_no: 1,
    date,
    started_at: `${date}T16:00:00.000Z`,
    finished_at: null,
    type: 'styrke',
    rpe: null,
    note: null,
    groin_during: null,
    source: 'app',
    external_id: null,
    distance_km: null,
    duration_sec: null,
    avg_hr: null,
    updated_at: ts,
  });

let n = 0;
const set = (workout_uuid: string, set_no: number, side: 'H' | 'V' | null, weight_kg: number | null, reps: number, done = true): SetLog => ({
  uuid: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  workout_uuid,
  exercise_id: 'enbens-rdl',
  set_no,
  side,
  weight_kg,
  reps,
  seconds: null,
  rpe: null,
  done,
  updated_at: ts,
  deleted_at: null,
});

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const C = '10000000-0000-4000-8000-000000000003';

describe('decimaltal', () => {
  it('læser komma og punktum', () => {
    expect(parseDecimal('12,5')).toBe(12.5);
    expect(parseDecimal('12.5')).toBe(12.5);
    expect(parseDecimal('12,')).toBe(12);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
    expect(formatDecimal(12.5)).toBe('12,5');
    expect(sanitizeDecimal('12,5,3')).toBe('12,53');
    expect(sanitizeDecimal('1a2')).toBe('12');
  });
});

describe('sidste gang', () => {
  const workouts = [workout(A, '2026-09-28'), workout(B, '2026-10-05'), workout(C, '2026-10-12')];
  const sets = [
    set(A, 1, 'H', 10, 8),
    set(A, 1, 'V', 10, 8),
    set(B, 1, 'H', 12.5, 8),
    set(B, 1, 'V', 12.5, 8),
    set(B, 2, 'H', 12.5, 8),
    set(B, 2, 'V', 12.5, 7),
    set(C, 1, 'H', 15, 8, false),
  ];

  it('vælger seneste anden træning, ikke den aktuelle', () => {
    const last = pickLastTime('enbens-rdl', { uuid: C, date: '2026-10-12' }, workouts, sets, []);
    expect(last?.workout.uuid).toBe(B);
  });

  it('giver spøgelsestal pr. sæt og side, med fallback til sidste sæt', () => {
    const last = pickLastTime('enbens-rdl', { uuid: C, date: '2026-10-12' }, workouts, sets, []);
    expect(ghostFor(last, 'V', 2)).toEqual({ weight_kg: 12.5, reps: 7, seconds: null });
    expect(ghostFor(last, 'H', 3)).toEqual({ weight_kg: 12.5, reps: 8, seconds: null });
  });

  it('opsummerer sæt', () => {
    const last = pickLastTime('enbens-rdl', { uuid: C, date: '2026-10-12' }, workouts, sets, [])!;
    expect(summarizeSets(last.sets, 'weight_reps')).toBe('H 2 × 8 @ 12,5 kg · V 1 × 8 @ 12,5 kg, 1 × 7 @ 12,5 kg');
    const even = pickLastTime('enbens-rdl', { uuid: B, date: '2026-10-05' }, workouts, sets, [])!;
    expect(summarizeSets(even.sets, 'weight_reps')).toBe('1 × 8/side @ 10 kg');
    expect(summarizeSets([set(A, 1, null, null, 5), set(A, 2, null, null, 5)], 'bodyweight_reps')).toBe('2 × 5');
  });
});

describe('pause efter sæt', () => {
  it('skiftevis unilateral: ingen pause mellem H og V, pause efter parret', () => {
    const ex = resolveStrengthSession(plan, 'styrke-a', 6).slots.flatMap((s) => s.exercises).find((e) => e.exercise.id === 'enbens-tahaev')!;
    const dose = ex.planned.dose;
    expect(restAfter(ex.rows, 0, dose, { supersetFirst: false })).toBe(0);
    expect(restAfter(ex.rows, 1, dose, { supersetFirst: false })).toBe(60);
  });

  it('superset: ingen pause efter første øvelse', () => {
    const slot = resolveStrengthSession(plan, 'styrke-b', 6).slots.find((s) => s.superset)!;
    const [first, second] = slot.exercises;
    expect(restAfter(first.rows, 0, first.planned.dose, { supersetFirst: true })).toBe(0);
    expect(restAfter(second.rows, 0, second.planned.dose, { supersetFirst: false })).toBe(60);
  });
});

describe('deterministisk uuid', () => {
  it('giver samme gyldige uuid for samme nøgle', async () => {
    const a = await deterministicUuid('set', A, 'enbens-rdl', 'H', 1);
    expect(a).toBe(await deterministicUuid('set', A, 'enbens-rdl', 'H', 1));
    expect(a).not.toBe(await deterministicUuid('set', A, 'enbens-rdl', 'V', 1));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('fremskridt og sammenfoldning', () => {
  const s = (exercise_id: string, set_no: number, side: 'H' | 'V' | null, done = true) => ({ ...set(A, set_no, side, 10, 8, done), exercise_id });

  it('tæller færdige rækker pr. plads, også superset', () => {
    const slot = resolveStrengthSession(plan, 'styrke-b', 6).slots.find((x) => x.superset)!;
    expect(slotProgress(plan, slot, [])).toEqual({ done: 0, total: 6 });
    expect(slotProgress(plan, slot, [s('biceps-curl', 1, null), s('triceps-pushdown', 1, null), s('triceps-pushdown', 2, null, false)])).toEqual({ done: 2, total: 6 });
  });

  it('tæller alternativ-øvelsens rækker, når den er logget', () => {
    const slot = resolveStrengthSession(plan, 'rehab-a', 3).slots.find((x) => x.slotId === 'rehab-a-4')!;
    expect(slotProgress(plan, slot, [s('adduktorklem', 1, null)])).toEqual({ done: 1, total: 3 });
  });

  it('finder næste ufærdige sektion', () => {
    const p = { a: { done: 2, total: 2 }, b: { done: 0, total: 3 }, c: { done: 3, total: 3 } };
    expect(nextIncomplete(['a', 'b', 'c'], p)).toBe('b');
    expect(nextIncomplete(['a', 'b', 'c'], p, 'b')).toBeNull();
  });

  it('placerer en dag i forhold til i dag', () => {
    expect([dayState('2026-10-05', '2026-10-08'), dayState('2026-10-08', '2026-10-08'), dayState('2026-10-10', '2026-10-08')]).toEqual(['past', 'today', 'future']);
  });
});
