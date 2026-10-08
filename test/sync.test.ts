import { beforeEach, describe, expect, it } from 'vitest';
import { pullChanges, pushChanges as push } from '../worker/services/sync';
import { call, createWorld, type World } from './world';

let w: World;
let db: D1Database;
const pushChanges = (d: D1Database, changes: Parameters<typeof push>[2], now?: string) => push(d, 1, changes, now);
beforeEach(async () => {
  w = await createWorld();
  db = w.db;
  // Seed stempler baseline-målingen med "nu"; flyt den bagud, så testenes faste tider giver mening.
  await db.prepare(`UPDATE mobility_measurements SET server_updated_at = '2026-09-27T00:00:00.000Z'`).run();
});

const W = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';

const workout = (updated_at: string, extra: Record<string, unknown> = {}) => ({
  uuid: W,
  planned_session_id: 'rehab-a',
  plan_version: 1,
  week_no: 2,
  date: '2026-10-05',
  started_at: '2026-10-05T16:00:00.000Z',
  finished_at: null,
  type: 'styrke',
  rpe: null,
  note: null,
  source: 'app',
  external_id: null,
  distance_km: null,
  duration_sec: null,
  avg_hr: null,
  updated_at,
  ...extra,
});

const setLog = (updated_at: string, extra: Record<string, unknown> = {}) => ({
  uuid: S,
  workout_uuid: W,
  exercise_id: 'enbens-rdl',
  set_no: 1,
  side: 'H',
  weight_kg: 12.5,
  reps: 8,
  seconds: null,
  rpe: null,
  done: true,
  updated_at,
  ...extra,
});

describe('sync-service', () => {
  it('gemmer og henter poster, med booleans intakte', async () => {
    await pushChanges(db, { workouts: [workout('2026-10-05T16:00:00.000Z')], set_logs: [setLog('2026-10-05T16:05:00.000Z')] }, '2026-10-05T16:05:01.000Z');
    const { changes, cursor } = await pullChanges(db, 1, null, new Date('2026-10-06T00:00:00Z'));
    expect(changes.workouts).toHaveLength(1);
    expect(changes.set_logs![0]).toMatchObject({ weight_kg: 12.5, done: true, side: 'H', deleted_at: null });
    expect(cursor).toBe('2026-10-05T16:05:01.000Z');
    // Baseline-målingen fra seed kommer også med ved første pull.
    expect(changes.mobility_measurements![0]).toMatchObject({ value_right: 5, value_left: 7 });
  });

  it('last-write-wins: ældre version overskriver ikke nyere', async () => {
    await pushChanges(db, { set_logs: [setLog('2026-10-05T16:10:00.000Z', { reps: 9 })] });
    await pushChanges(db, { set_logs: [setLog('2026-10-05T16:05:00.000Z', { reps: 7 })] });
    const row = await db.prepare('SELECT reps FROM set_logs WHERE uuid = ?').bind(S).first<{ reps: number }>();
    expect(row!.reps).toBe(9);
    await pushChanges(db, { set_logs: [setLog('2026-10-05T16:20:00.000Z', { reps: 10 })] });
    expect((await db.prepare('SELECT reps FROM set_logs WHERE uuid = ?').bind(S).first<{ reps: number }>())!.reps).toBe(10);
  });

  it('pull efter cursor giver kun nye ændringer, inkl. tombstones', async () => {
    await pushChanges(db, { set_logs: [setLog('2026-10-05T16:05:00.000Z')] }, '2026-10-05T16:05:01.000Z');
    const first = await pullChanges(db, 1, null, new Date('2026-10-06T00:00:00Z'));
    await pushChanges(db, { set_logs: [setLog('2026-10-06T08:00:00.000Z', { deleted_at: '2026-10-06T08:00:00.000Z' })] }, '2026-10-06T08:00:01.000Z');
    const second = await pullChanges(db, 1, first.cursor, new Date('2026-10-07T00:00:00Z'));
    expect(Object.keys(second.changes)).toEqual(['set_logs']);
    expect(second.changes.set_logs![0].deleted_at).toBe('2026-10-06T08:00:00.000Z');
  });

  it('holder cursoren lidt bagud, så netop skrevne poster hentes igen', async () => {
    await pushChanges(db, { set_logs: [setLog('2026-10-05T16:05:00.000Z')] }, '2026-10-05T16:05:01.000Z');
    const { cursor } = await pullChanges(db, 1, null, new Date('2026-10-05T16:05:01.500Z'));
    expect(cursor! < '2026-10-05T16:05:01.000Z').toBe(true);
  });

  it('afviser ugyldige poster', async () => {
    await expect(pushChanges(db, { set_logs: [setLog('2026-10-05T16:05:00.000Z', { side: 'X' })] })).rejects.toThrow(/Ugyldig post i set_logs/);
  });
});

describe('sync-API', () => {
  it('push og pull over HTTP', async () => {
    const res = await call(w, w.simon, '/api/a/simon/sync/push', { method: 'POST', json: { changes: { workouts: [workout('2026-10-05T16:00:00.000Z')] } } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: 1 });
    const pull = await call(w, w.simon, '/api/a/simon/sync/pull');
    const body = (await pull.json()) as { changes: { workouts: unknown[] } };
    expect(body.changes.workouts).toHaveLength(1);
  });

  it('afviser ukendt tabel, ugyldig cursor og fremmede monitors', async () => {
    const bad = await call(w, w.simon, '/api/a/simon/sync/push', { method: 'POST', json: { changes: { users: [] } } });
    expect(bad.status).toBe(400);
    expect((await call(w, w.simon, '/api/a/simon/sync/pull?since=igår')).status).toBe(400);
    const pain = { uuid: '22222222-2222-4222-8222-000000000009', monitor_id: 999, workout_uuid: W, date: '2026-10-05', kind: 'under', score: 2, updated_at: '2026-10-05T16:00:00.000Z' };
    const res = await call(w, w.simon, '/api/a/simon/sync/push', { method: 'POST', json: { changes: { pain_scores: [pain] } } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('Ukendt monitor');
  });
});
