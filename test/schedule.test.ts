import { beforeEach, describe, expect, it } from 'vitest';
import planJson from '../plan/plan.v1.json';
import { PlanSchema } from '../shared/plan.schema';
import { ScheduleOverride } from '../shared/records.schema';
import { effectiveSessions } from '../shared/schedule';
import { getWeeklySummary } from '../worker/services/history';
import { getWeek } from '../worker/services/plan';
import { pullChanges, pushChanges } from '../worker/services/sync';
import { createSeededD1 } from './d1';

const plan = PlanSchema.parse(planJson);
const week2 = plan.weeks.find((w) => w.weekNo === 2)!;
const ts = '2026-10-07T10:00:00.000Z';

const move = (session_id: string, day: number, extra: Record<string, unknown> = {}) =>
  ScheduleOverride.parse({ uuid: '50000000-0000-4000-8000-000000000001', week_no: 2, session_id, day, updated_at: ts, ...extra });

describe('flytning af sessioner', () => {
  it('lægger flytninger ovenpå planen og sorterer efter faktisk dag', () => {
    const s = effectiveSessions(week2, [move('rehab-b', 5)]);
    expect(s.map((x) => [x.sessionId, x.day, x.plannedDay, x.moved])).toEqual([
      ['rehab-a', 1, 1, false],
      ['rh', 3, 3, false],
      ['rehab-b', 5, 4, true],
      ['ct', 6, 6, false],
    ]);
  });

  it('ignorerer tombstones og andre ugers flytninger', () => {
    expect(effectiveSessions(week2, [move('rehab-b', 5, { deleted_at: ts })]).find((x) => x.sessionId === 'rehab-b')!.day).toBe(4);
    expect(effectiveSessions(week2, [move('rehab-b', 5, { week_no: 3 })]).find((x) => x.sessionId === 'rehab-b')!.day).toBe(4);
  });
});

describe('flytning og aktiviteter i D1', () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await createSeededD1();
  });

  it('synker flytninger og bruger dem i getWeek og ugeopsummeringen', async () => {
    await pushChanges(db, { schedule_overrides: [move('rh', 2)] });
    const week = await getWeek(db, 2);
    expect(week.sessions.map((s) => [s.session.id, s.date])).toEqual([
      ['rehab-a', '2026-10-05'],
      ['rh', '2026-10-06'],
      ['rehab-b', '2026-10-08'],
      ['ct', '2026-10-10'],
    ]);
    expect((await getWeeklySummary(db, 2, '2026-10-12')).sessions.find((s) => s.sessionId === 'rh')).toMatchObject({ day: 2, plannedDay: 3 });
    const { changes } = await pullChanges(db, null, new Date('2026-10-12T00:00:00Z'));
    expect(changes.schedule_overrides).toHaveLength(1);
  });

  it('gemmer en aktivitet uden for planen og viser den som ekstra i ugen', async () => {
    await pushChanges(db, {
      workouts: [
        {
          uuid: '50000000-0000-4000-8000-0000000000aa',
          planned_session_id: null,
          plan_version: 1,
          week_no: 2,
          date: '2026-10-09',
          started_at: '2026-10-09T18:00:00.000Z',
          finished_at: '2026-10-09T19:30:00.000Z',
          type: 'cardio',
          rpe: 7,
          note: null,
          groin_during: 4,
          source: 'app',
          external_id: null,
          distance_km: null,
          duration_sec: 5400,
          avg_hr: 142,
          activity: 'Padel',
          updated_at: ts,
        },
      ],
    });
    const w = await getWeeklySummary(db, 2, '2026-10-12');
    expect(w.extras).toEqual([{ workoutUuid: '50000000-0000-4000-8000-0000000000aa', date: '2026-10-09', name: 'Padel', durationSec: 5400, light: 'gul' }]);
    // Aktiviteten tæller ikke som en planlagt session.
    expect(w.done).toBe(0);
    const { changes } = await pullChanges(db, null, new Date('2026-10-12T00:00:00Z'));
    expect(changes.workouts![0]).toMatchObject({ activity: 'Padel', type: 'cardio' });
  });
});
