import { beforeEach, describe, expect, it } from 'vitest';
import planJson from '../plan/plan.v1.json';
import { PlanSchema } from '../shared/plan.schema';
import { ScheduleOverride } from '../shared/records.schema';
import { effectiveSessions } from '../shared/schedule';
import { getWeeklySummary as summary } from '../worker/services/history';
import { listCoachNotes } from '../worker/services/notes';
import { findActivePlan, getWeek as week } from '../worker/services/plan';
import { pullChanges as pull, pushChanges as push } from '../worker/services/sync';
import { createSeededD1 } from './d1';

// Atleten simon (id 1).
const pushChanges = (d: D1Database, changes: Parameters<typeof push>[2]) => push(d, 1, changes);
const pullChanges = (d: D1Database, since: string | null, now?: Date) => pull(d, 1, since, now);
const getWeeklySummary = (d: D1Database, weekNo: number, asOf?: string) => summary(d, 1, weekNo, asOf);
const getWeek = (d: D1Database, weekNo: number) => week(d, 1, weekNo);

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
          source: 'app',
          external_id: null,
          distance_km: null,
          duration_sec: 5400,
          avg_hr: 142,
          activity: 'Padel',
          updated_at: ts,
        },
      ],
      pain_scores: [{ uuid: '50000000-0000-4000-8000-0000000000ab', monitor_id: 1, workout_uuid: '50000000-0000-4000-8000-0000000000aa', date: '2026-10-09', kind: 'under', score: 4, updated_at: ts }],
    });
    const w = await getWeeklySummary(db, 2, '2026-10-12');
    expect(w.extras).toEqual([{ workoutUuid: '50000000-0000-4000-8000-0000000000aa', date: '2026-10-09', name: 'Padel', durationSec: 5400, light: 'gul' }]);
    // Aktiviteten tæller ikke som en planlagt session.
    expect(w.done).toBe(0);
    const { changes } = await pullChanges(db, null, new Date('2026-10-12T00:00:00Z'));
    expect(changes.workouts![0]).toMatchObject({ activity: 'Padel', type: 'cardio' });
  });
});

describe('en ny plan med samme ugenumre', () => {
  let db: D1Database;
  /** Planen flyttet `days` dage frem (et multiplum af 7, så ugerne stadig starter mandag). */
  const shifted = (days: number) =>
    JSON.parse(JSON.stringify(planJson).replace(/"(\d{4}-\d{2}-\d{2})"/g, (_, d: string) => `"${new Date(Date.parse(d) + days * 86_400_000).toISOString().slice(0, 10)}"`));
  const note = (uuid: string, created_at: string) => ({ uuid, created_at, week_no: 2, session_id: null, text: 'Tag den roligt', updated_at: created_at });

  beforeEach(async () => {
    db = await createSeededD1();
    // Den gamle plans uge 2: en flytning og en note.
    await pushChanges(db, { schedule_overrides: [move('rh', 2)], coach_notes: [note('50000000-0000-4000-8000-0000000000c1', ts)] });
    // En ny plan (ny startdato, 5 uger senere), oprettet efter den gamle uge 2.
    const next = PlanSchema.parse(shifted(35));
    await db.batch([
      db.prepare('UPDATE plan_versions SET is_active = 0 WHERE athlete_id = 1'),
      db
        .prepare("INSERT INTO plan_versions (athlete_id, version, created_at, source, note, plan_json, is_active) VALUES (1, 2, '2026-10-30T12:00:00.000Z', 'manual', 'Ny plan', ?, 1)")
        .bind(JSON.stringify(next)),
    ]);
  });

  it('begynder, da den nye plan blev oprettet; rettelser af planen bygger videre på den', async () => {
    expect((await findActivePlan(db, 1))!.startedAt).toBe('2026-10-30T12:00:00.000Z');
    const active = (await findActivePlan(db, 1))!;
    await db
      .prepare("INSERT INTO plan_versions (athlete_id, version, created_at, source, note, plan_json, is_active, based_on_version) VALUES (1, 3, '2026-11-04T08:00:00.000Z', 'manual', 'Rettelse', ?, 0, 2)")
      .bind(JSON.stringify(active.plan))
      .run();
    await db.batch([db.prepare('UPDATE plan_versions SET is_active = 0 WHERE athlete_id = 1'), db.prepare('UPDATE plan_versions SET is_active = 1 WHERE athlete_id = 1 AND version = 3')]);
    expect((await findActivePlan(db, 1))!.startedAt).toBe('2026-10-30T12:00:00.000Z');
  });

  it('bruger ikke den gamle plans flytninger og noter i samme uge', async () => {
    expect((await getWeek(db, 2)).sessions.find((s) => s.session.id === 'rh')!.scheduled.moved).toBe(false);
    expect(await listCoachNotes(db, 1, { weekNo: 2 })).toEqual([]);
    expect(await listCoachNotes(db, 1, { weekNo: 2, includeOtherPlans: true })).toHaveLength(1);

    // Flyttes sessionen i den nye plan, overskrives posten (samme uuid) og gælder igen.
    await pushChanges(db, { schedule_overrides: [move('rh', 2, { updated_at: '2026-11-10T09:00:00.000Z' })], coach_notes: [note('50000000-0000-4000-8000-0000000000c2', '2026-11-09T09:00:00.000Z')] });
    expect((await getWeek(db, 2)).sessions.find((s) => s.session.id === 'rh')!.scheduled.moved).toBe(true);
    expect((await getWeeklySummary(db, 2)).sessions.find((s) => s.sessionId === 'rh')!.day).toBe(2);
    expect((await listCoachNotes(db, 1, { weekNo: 2 })).map((n) => n.uuid)).toEqual(['50000000-0000-4000-8000-0000000000c2']);
  });
});

describe('sprunget over', () => {
  it('logges med årsag og tæller ikke som lavet eller i trafiklyset', async () => {
    const db = await createSeededD1();
    await pushChanges(db, {
      workouts: [
        {
          uuid: '50000000-0000-4000-8000-0000000000bb',
          planned_session_id: 'rehab-b',
          plan_version: 1,
          week_no: 2,
          date: '2026-10-08',
          started_at: null,
          finished_at: null,
          type: 'styrke',
          rpe: null,
          note: 'Lysken stram efter løbet',
          source: 'app',
          external_id: null,
          distance_km: null,
          duration_sec: null,
          avg_hr: null,
          skipped_at: '2026-10-08T15:00:00.000Z',
          skip_reason: 'Lyske/smerte',
          updated_at: ts,
        },
      ],
    });
    const w = await getWeeklySummary(db, 2, '2026-10-12');
    expect(w.sessions.find((s) => s.sessionId === 'rehab-b')).toMatchObject({ status: 'sprunget-over', skipReason: 'Lyske/smerte' });
    expect(w).toMatchObject({ done: 0, skipped: 1, lights: [] });
    const { changes } = await pullChanges(db, null, new Date('2026-10-12T00:00:00Z'));
    expect(changes.workouts![0]).toMatchObject({ skip_reason: 'Lyske/smerte', skipped_at: '2026-10-08T15:00:00.000Z' });
  });
});
