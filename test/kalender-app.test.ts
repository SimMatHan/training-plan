// Kalenderen og dagsoverblikket i appen: hvad der står på hver dag.
import { describe, expect, it } from 'vitest';
import planJson from '../plan/plan.v1.json';
import { PlanSchema } from '../shared/plan.schema';
import { MobilityRoundCheck, ScheduleOverride, Workout } from '../shared/records.schema';
import { dayEntries, mondayOf, monthGrid, roundsByDate, shiftMonth } from '../src/logic/calendar';

const plan = PlanSchema.parse(planJson);
const ts = '2026-10-07T10:00:00.000Z';
let n = 0;
const uuid = () => `60000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const workout = (w: Partial<Workout> & Pick<Workout, 'date' | 'type'>) =>
  Workout.parse({
    uuid: uuid(),
    updated_at: ts,
    planned_session_id: null,
    plan_version: 1,
    week_no: null,
    started_at: ts,
    finished_at: ts,
    rpe: null,
    note: null,
    source: 'app',
    external_id: null,
    distance_km: null,
    duration_sec: null,
    avg_hr: null,
    ...w,
  });

// Uge 2 (5.–11. okt.): rehab-a man, rh ons, rehab-b tor, ct lør.
const week = (from: string, to: string, workouts: Workout[], overrides: ScheduleOverride[] = [], today = '2026-10-09') =>
  dayEntries(plan, workouts, overrides, from, to, today);
const brief = (m: Map<string, { title: string; state: string }[]>) => Object.fromEntries([...m].map(([d, l]) => [d, l.map((e) => `${e.title}: ${e.state}`)]));

describe('kalenderens dage', () => {
  it('viser planlagte sessioner på deres dag, misset når dagen er gået', () => {
    const days = week('2026-10-05', '2026-10-11', []);
    expect(brief(days)).toEqual({
      '2026-10-05': ['Rehab A: misset'],
      '2026-10-07': ['Rehab-løb: misset'],
      '2026-10-08': ['Rehab B: misset'],
      '2026-10-10': ['Crosstrainer: planlagt'],
    });
  });

  it('lægger en lavet session på den dag, den blev lavet, og husker planens dag', () => {
    const w = workout({ date: '2026-10-09', type: 'styrke', planned_session_id: 'rehab-b', week_no: 2 });
    const days = week('2026-10-05', '2026-10-11', [w]);
    expect(days.get('2026-10-08')).toBeUndefined();
    expect(days.get('2026-10-09')).toEqual([expect.objectContaining({ title: 'Rehab B', state: 'lavet', plannedDate: '2026-10-08', workout: w })]);
  });

  it('følger flytninger og viser sprunget over og i gang', () => {
    const moved = ScheduleOverride.parse({ uuid: uuid(), week_no: 2, session_id: 'ct', day: 7, updated_at: ts });
    const skipped = workout({ date: '2026-10-05', type: 'styrke', planned_session_id: 'rehab-a', week_no: 2, started_at: null, finished_at: null, skipped_at: ts, skip_reason: 'Syg' });
    const going = workout({ date: '2026-10-07', type: 'løb', planned_session_id: 'rh', week_no: 2, finished_at: null });
    const days = week('2026-10-05', '2026-10-11', [skipped, going], [moved]);
    expect(brief(days)).toEqual({
      '2026-10-05': ['Rehab A: sprunget-over'],
      '2026-10-07': ['Rehab-løb: i-gang'],
      '2026-10-08': ['Rehab B: misset'],
      '2026-10-11': ['Crosstrainer: planlagt'],
    });
    expect(days.get('2026-10-11')![0]).toMatchObject({ movedFrom: 6, plannedDay: 6, weekNo: 2 });
  });

  it('tager aktiviteter uden for planen og en tidligere plans træninger med på deres dato', () => {
    const padel = workout({ date: '2026-10-06', type: 'cardio', activity: 'Padel' });
    const old = workout({ date: '2026-09-20', type: 'styrke', planned_session_id: 'noget-gammelt', week_no: 2 });
    const days = week('2026-09-14', '2026-10-06', [padel, old]);
    expect(days.get('2026-10-06')).toEqual([expect.objectContaining({ title: 'Padel', state: 'lavet', category: 'cardio', session: null })]);
    expect(days.get('2026-09-20')).toEqual([expect.objectContaining({ title: 'Styrke', state: 'lavet', session: null })]);
  });

  it('udelader slettede træninger og dage uden for perioden', () => {
    const gone = workout({ date: '2026-10-08', type: 'styrke', planned_session_id: 'rehab-b', week_no: 2, deleted_at: ts });
    const days = week('2026-10-08', '2026-10-08', [gone]);
    expect(brief(days)).toEqual({ '2026-10-08': ['Rehab B: misset'] });
  });

  it('tæller afkrydsede punkter i mobilitetsrunderne pr. dato', () => {
    const items = plan.mobility!.items;
    const check = (date: string, round: 'morgen' | 'aften', item_id: string, done = true) =>
      MobilityRoundCheck.parse({ uuid: uuid(), updated_at: ts, date, round, item_id, done });
    const rounds = roundsByDate(plan, [
      check('2026-10-08', 'aften', items[0].id),
      check('2026-10-08', 'morgen', items[0].id),
      check('2026-10-08', 'morgen', items[1].id),
      check('2026-10-08', 'morgen', items[2].id, false),
      check('2026-10-08', 'morgen', 'ukendt-punkt'),
    ]);
    expect(rounds.get('2026-10-08')).toEqual([
      { round: 'morgen', done: 2, total: items.length },
      { round: 'aften', done: 1, total: items.length },
    ]);
  });
});

describe('månedsgitteret', () => {
  it('har hele uger fra mandag til søndag', () => {
    const grid = monthGrid('2026-11');
    expect(grid).toHaveLength(6);
    expect(grid[0][0]).toBe('2026-10-26');
    expect(grid.at(-1)![6]).toBe('2026-12-06');
    expect(monthGrid('2027-02')[0][0]).toBe('2027-02-01');
    expect(monthGrid('2027-02')).toHaveLength(4);
  });

  it('skifter måned og finder mandagen', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(mondayOf('2026-11-25')).toBe('2026-11-23');
    expect(mondayOf('2026-11-23')).toBe('2026-11-23');
    expect(mondayOf('2026-11-29')).toBe('2026-11-23');
  });
});
