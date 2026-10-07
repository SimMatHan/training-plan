import { describe, expect, it } from 'vitest';
import planJson from '../plan/plan.v1.json';
import { PlanSchema } from '../shared/plan.schema';
import { SetLog, Workout } from '../shared/records.schema';
import { formatDose, getExercise, resolveStrengthSession, setRows, weekForDate } from '../shared/resolve';

const plan = PlanSchema.parse(planJson);

describe('plan v1', () => {
  it('dækker 14 uger fra 28. sep til løbet 31. dec', () => {
    expect(plan.weeks.map((w) => w.weekNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(plan.startDate).toBe('2026-09-28');
    expect(plan.raceDate).toBe('2026-12-31');
    expect(plan.weeks.at(-1)!.sessions.find((s) => s.sessionId === 'lob')!.day).toBe(4); // torsdag 31/12
  });

  it('finder ugen ud fra dato', () => {
    expect(weekForDate(plan, '2026-09-27')).toBeUndefined();
    expect(weekForDate(plan, '2026-09-28')!.weekNo).toBe(1);
    expect(weekForDate(plan, '2026-10-07')!.weekNo).toBe(2);
    expect(weekForDate(plan, '2026-12-31')!.weekNo).toBe(14);
    expect(weekForDate(plan, '2027-01-04')).toBeUndefined();
  });

  it('roterer Styrke A i uge 9–12 og tilbage i uge 13', () => {
    const ids = (w: number) => resolveStrengthSession(plan, 'styrke-a', w).slots.map((s) => s.exercises[0].exercise.id);
    expect(ids(8)).toEqual(['rdl', 'bulgarian-split-squat', 'nordic-hamstring-curl', 'enbens-tahaev', 'copenhagen-plank', 'hip-airplane']);
    expect(ids(9)).toEqual(['enbens-rdl', 'step-down', 'glideskinne-leg-curl', 'enbens-tahaev', 'copenhagen-plank', 'pallof-press']);
    expect(ids(13)).toEqual(ids(8));
  });

  it('udtrykker supersets som to øvelser på samme plads', () => {
    const slot = resolveStrengthSession(plan, 'styrke-b', 6).slots.find((s) => s.superset)!;
    expect(slot.exercises.map((e) => e.exercise.id)).toEqual(['biceps-curl', 'triceps-pushdown']);
  });

  it('giver tåhæv forskellig dosis pr. side, højre først', () => {
    const tahaev = resolveStrengthSession(plan, 'styrke-a', 6).slots.flatMap((s) => s.exercises).find((e) => e.exercise.id === 'enbens-tahaev')!;
    expect(formatDose(tahaev.exercise, tahaev.planned.dose)).toBe('3 × 12 H / 3 × 10 V');
    expect(tahaev.rows.map((r) => `${r.side}${r.setNo}:${r.reps!.max}`)).toEqual(['H1:12', 'V1:10', 'H2:12', 'V2:10', 'H3:12', 'V3:10']);
  });

  it('har Copenhagen-alternativ i rehab uge 3', () => {
    const slot = resolveStrengthSession(plan, 'rehab-a', 3).slots.find((s) => s.slotId === 'rehab-a-4')!;
    expect(slot.exercises[0].exercise.id).toBe('copenhagen-plank');
    expect(slot.exercises[0].planned.alternative?.exerciseId).toBe('adduktorklem');
  });
});

describe('setRows', () => {
  const ex = getExercise(plan, 'enbens-rdl')!;
  it('kan lægge siderne blokvis', () => {
    const rows = setRows(ex, { sets: 2, optionalSets: 0, reps: { min: 8, max: 8 }, restSec: 60, sideOrder: ['V', 'H'], sidePattern: 'block' });
    expect(rows.map((r) => `${r.side}${r.setNo}`)).toEqual(['V1', 'V2', 'H1', 'H2']);
  });
  it('markerer valgfrie sæt', () => {
    const rows = setRows(getExercise(plan, 'rdl')!, { sets: 2, optionalSets: 1, reps: { min: 8, max: 8 }, restSec: 90 });
    expect(rows.map((r) => r.optional)).toEqual([false, false, true]);
  });
});

describe('records', () => {
  it('validerer en workout og et sæt', () => {
    const now = '2026-10-05T17:03:12.345Z';
    const w = Workout.parse({
      uuid: crypto.randomUUID(),
      planned_session_id: 'rehab-a',
      plan_version: 1,
      week_no: 2,
      date: '2026-10-05',
      started_at: now,
      finished_at: null,
      type: 'styrke',
      rpe: 6.5,
      note: null,
      groin_during: 2,
      source: 'app',
      external_id: null,
      distance_km: null,
      duration_sec: null,
      avg_hr: null,
      updated_at: now,
    });
    expect(w.deleted_at).toBeNull();
    expect(() =>
      SetLog.parse({ uuid: crypto.randomUUID(), workout_uuid: w.uuid, exercise_id: 'enbens-rdl', set_no: 1, side: 'X', weight_kg: 12.5, reps: 8, seconds: null, rpe: null, done: true, updated_at: now }),
    ).toThrow();
  });
});
