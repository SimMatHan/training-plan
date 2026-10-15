import { describe, expect, it } from 'vitest';
import planJson from '../plan/plan.v1.json';
import { PlanSchema } from '../shared/plan.schema';
import type { SetLog } from '../shared/records.schema';
import { getExercise, resolveStrengthSession, setRows } from '../shared/resolve';
import { EXTRA_STEP, extraSetRows, extraSlots, nextSetNo, plannedExerciseIds } from '../src/logic/extras';

const plan = PlanSchema.parse(planJson);
const W = '10000000-0000-4000-8000-000000000001';
let n = 0;
const log = (exercise_id: string, set_no: number, side: 'H' | 'V' | null, values: Partial<SetLog> = {}): SetLog => ({
  uuid: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  workout_uuid: W,
  exercise_id,
  set_no,
  side,
  weight_kg: null,
  reps: null,
  seconds: null,
  rpe: null,
  done: false,
  updated_at: '2026-11-02T16:00:00.000Z',
  deleted_at: null,
  ...values,
});

describe('ekstra sæt', () => {
  const rdl = getExercise(plan, 'rdl')!;
  const bss = getExercise(plan, 'bulgarian-split-squat')!;
  const dose = { sets: 3, optionalSets: 0, reps: { min: 8, max: 8 }, restSec: 90 };

  it('rækker for loggede sæt over planens, begge sider for sidevise øvelser', () => {
    const rows = setRows(rdl, dose);
    expect(extraSetRows(rows, [log('rdl', 2, null), log('rdl', 4, null, { done: true })], rdl, dose)).toEqual([
      { setNo: 4, side: null, reps: dose.reps, seconds: undefined, optional: false, extra: true },
    ]);
    const side = setRows(bss, dose);
    expect(extraSetRows(side, [log('bulgarian-split-squat', 4, 'H')], bss, dose).map((r) => r.side)).toEqual(['H', 'V']);
    expect(extraSetRows(rows, [log('rdl', 4, null, { deleted_at: '2026-11-02T16:01:00.000Z' })], rdl, dose)).toEqual([]);
  });

  it('næste sætnummer er efter planens og de loggede', () => {
    const rows = setRows(rdl, dose);
    expect(nextSetNo(rows, [], 'rdl')).toBe(4);
    expect(nextSetNo(rows, [log('rdl', 5, null)], 'rdl')).toBe(6);
    expect(nextSetNo(rows, [log('andet', 9, null)], 'rdl')).toBe(4);
  });
});

describe('ekstra øvelser', () => {
  const slots = resolveStrengthSession(plan, 'styrke-a', 6).slots;
  const planned = plannedExerciseIds(slots);

  it('er de loggede øvelser, sessionen ikke har i ugen, sorteret efter navn', () => {
    const extras = extraSlots(plan, planned, [log('rdl', 1, null), log('skulderpres', 1, null), log('face-pull', 1, null), log('face-pull', 2, null)]);
    expect(extras.map((s) => s.slotId)).toEqual([`${EXTRA_STEP}face-pull`, `${EXTRA_STEP}skulderpres`]);
    // Doseringen er den, øvelsen har andre steder i planen.
    expect(extras[0].exercises[0].rows.length).toBeGreaterThan(0);
  });

  it('en øvelse der er udgået af planen, vises ud fra loggen', () => {
    const [extra] = extraSlots(plan, planned, [log('gammel-oevelse', 1, 'H', { seconds: 30 })]);
    expect(extra.exercises[0].exercise).toEqual({ id: 'gammel-oevelse', name: 'gammel-oevelse', kind: 'time', perSide: true });
  });
});
