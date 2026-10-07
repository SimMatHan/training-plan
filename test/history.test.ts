import { beforeEach, describe, expect, it } from 'vitest';
import planJson from '../plan/plan.v1.json';
import { PlanSchema } from '../shared/plan.schema';
import { findPlannedDose, readyForMoreWeight } from '../shared/progression';
import { SetLog, type SetLog as SL } from '../shared/records.schema';
import { app } from '../worker/index';
import { exportAll, getExerciseHistory, getWeeklySummary } from '../worker/services/history';
import { pushChanges } from '../worker/services/sync';
import { createSeededD1 } from './d1';

const plan = PlanSchema.parse(planJson);
const W = '40000000-0000-4000-8000-ffffffffffff';
const ts = '2026-10-01T10:00:00.000Z';
let n = 0;
const id = () => `40000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const workout = (date: string, weekNo: number, sessionId: string, extra: Record<string, unknown> = {}) => ({
  uuid: id(),
  planned_session_id: sessionId,
  plan_version: 1,
  week_no: weekNo,
  date,
  started_at: `${date}T16:00:00.000Z`,
  finished_at: `${date}T17:00:00.000Z`,
  type: 'styrke',
  rpe: null,
  note: null,
  groin_during: 2,
  source: 'app',
  external_id: null,
  distance_km: null,
  duration_sec: null,
  avg_hr: null,
  updated_at: ts,
  ...extra,
});

const set = (workout_uuid: string, exercise_id: string, set_no: number, side: 'H' | 'V' | null, weight_kg: number | null, reps: number, done = true): SL =>
  SetLog.parse({ uuid: id(), workout_uuid, exercise_id, set_no, side, weight_kg, reps, seconds: null, rpe: null, done, updated_at: ts });

describe('progression: klar til mere vægt', () => {
  // Styrke B uge 6: rows 3 × 10 @ RPE 7.
  const { exercise, dose } = findPlannedDose(plan, 'styrke-b', 6, 'rows')!;
  const all = (reps: number) => [1, 2, 3].map((i) => set(W, 'rows', i, null, 30, reps));

  it('finder planens dosering for øvelsen i ugen', () => {
    expect(dose).toMatchObject({ sets: 3, reps: { min: 10, max: 10 }, intensity: { kind: 'rpe', max: 7 } });
  });

  it('kræver alle sæt i toppen og RPE ≤ mål', () => {
    expect(readyForMoreWeight(exercise, dose, all(10), 7)).toBe(true);
    expect(readyForMoreWeight(exercise, dose, all(10), 7.5)).toBe(false);
    expect(readyForMoreWeight(exercise, dose, all(10), null)).toBe(false);
    expect(readyForMoreWeight(exercise, dose, [...all(10).slice(0, 2), set(W, 'rows', 3, null, 30, 9)], 7)).toBe(false);
    expect(readyForMoreWeight(exercise, dose, all(10).slice(0, 2), 7)).toBe(false);
  });

  it('unilateral med forskellig dosis pr. side: begge sider skal ramme toppen', () => {
    const t = findPlannedDose(plan, 'styrke-a', 6, 'enbens-tahaev')!;
    const sets = [1, 2, 3].flatMap((i) => [set(W, 'enbens-tahaev', i, 'H', 10, 12), set(W, 'enbens-tahaev', i, 'V', 10, 10)]);
    expect(readyForMoreWeight(t.exercise, t.dose, sets, 7)).toBe(true);
    sets[5] = set(W, 'enbens-tahaev', 3, 'V', 10, 9);
    expect(readyForMoreWeight(t.exercise, t.dose, sets, 7)).toBe(false);
  });

  it('finder alternativ-øvelsens dosering', () => {
    expect(findPlannedDose(plan, 'rehab-a', 3, 'adduktorklem')?.dose.seconds).toEqual({ min: 30, max: 30 });
  });
});

describe('historik-services (uden HTTP)', () => {
  let db: D1Database;
  const a = workout('2026-10-05', 2, 'rehab-b');
  const b = workout('2026-10-08', 2, 'rehab-b', { groin_during: 5 });
  const run = workout('2026-10-07', 2, 'rh', { type: 'løb', distance_km: 5.05, duration_sec: 1666 });
  const mobility = workout('2026-10-06', 2, 'mobilitet', { type: 'mobilitet', groin_during: null });

  beforeEach(async () => {
    db = await createSeededD1();
    await pushChanges(db, {
      workouts: [a, b, run, mobility],
      set_logs: [set(a.uuid, 'rows', 1, null, 30, 10), set(a.uuid, 'rows', 2, null, 30, 9), set(b.uuid, 'rows', 1, null, 32.5, 10), set(b.uuid, 'rows', 2, null, 35, 8, false)],
      exercise_notes: [{ uuid: id(), workout_uuid: b.uuid, exercise_id: 'rows', note: 'Tungt', rpe: 8, updated_at: ts }],
    });
  });

  it('getExerciseHistory: nyeste først, med topvægt og volumen', async () => {
    const h = await getExerciseHistory(db, 'rows');
    expect(h.map((e) => [e.date, e.topWeight, e.volumeKg, e.rpe, e.note])).toEqual([
      ['2026-10-08', 32.5, 325, 8, 'Tungt'],
      ['2026-10-05', 30, 570, null, null],
    ]);
    expect(await getExerciseHistory(db, 'rows', 1)).toHaveLength(1);
    expect(await getExerciseHistory(db, 'rdl')).toEqual([]);
  });

  it('getWeeklySummary: sessioner, løbe-km, volumen og trafiklys', async () => {
    const w = await getWeeklySummary(db, 2, '2026-10-12');
    expect(w.sessions.map((s) => [s.sessionId, s.status])).toEqual([
      ['rehab-a', 'ikke-lavet'],
      ['rh', 'lavet'],
      ['rehab-b', 'lavet'],
      ['ct', 'ikke-lavet'],
    ]);
    expect(w).toMatchObject({ done: 2, planned: 4, runKm: 5.05, mobilityDays: 1 });
    expect(w.volume).toEqual([{ exerciseId: 'rows', name: 'Kabelrows eller håndvægtsrows', sets: 3, reps: 29, volumeKg: 895 }]);
    // Ingen morgenscorer: under ≤ 3 → ukendt; under 5 → gul.
    expect(w.lights).toEqual(['ukendt', 'ukendt', 'gul']);
  });

  it('exportAll indeholder planversioner og alle tabeller', async () => {
    const data = await exportAll(db);
    expect(data.planVersions[0]).toMatchObject({ version: 1, is_active: true, source: 'seed' });
    expect(data.planVersions[0].plan.weeks).toHaveLength(14);
    expect(data.workouts).toHaveLength(4);
    expect(data.set_logs).toHaveLength(4);
    expect(data.mobility_measurements).toHaveLength(1);
  });

  it('eksport og historik over HTTP kræver token', async () => {
    const env = { DB: db, API_TOKEN: 't', ASSETS: {} as Fetcher };
    expect((await app.request('/api/export', {}, env)).status).toBe(401);
    const res = await app.request('/api/export', { headers: { Authorization: 'Bearer t' } }, env);
    expect(res.headers.get('Content-Disposition')).toMatch(/traeningsnav-eksport-\d{4}-\d{2}-\d{2}\.json/);
    expect((await app.request('/api/history/weeks/99', { headers: { Authorization: 'Bearer t' } }, env)).status).toBe(404);
  });
});
