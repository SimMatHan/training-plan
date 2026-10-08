import { beforeEach, describe, expect, it } from 'vitest';
import { activatePlanVersion, getActivePlan, getWeek, getWeekNoForDate, listPlanVersions } from '../worker/services/plan';
import { call, createWorld, type World } from './world';

let w: World;
let db: D1Database;
const SIMON = 1;
beforeEach(async () => {
  w = await createWorld();
  db = w.db;
});

/** Indsætter en kopi af aktiv plan som ny version. */
async function addVersion(version: number) {
  const { plan } = await getActivePlan(db, SIMON);
  await db
    .prepare(`INSERT INTO plan_versions (athlete_id, version, created_at, source, note, plan_json, is_active, based_on_version) VALUES (?, ?, ?, 'manual', 'test', ?, 0, 1)`)
    .bind(SIMON, version, '2026-10-08T10:00:00.000Z', JSON.stringify(plan))
    .run();
}

describe('plan-services (uden HTTP)', () => {
  it('henter aktiv plan fra seed for atleten simon', async () => {
    expect(w.simon.athleteId).toBe(SIMON);
    const { meta, plan } = await getActivePlan(db, SIMON);
    expect(meta).toMatchObject({ version: 1, source: 'seed', is_active: true });
    expect(plan.weeks).toHaveLength(14);
  });

  it('getWeek giver sessioner med konkret dosering', async () => {
    const week = await getWeek(db, SIMON, 2);
    expect(week.week.startDate).toBe('2026-10-05');
    expect(week.sessions.map((s) => s.session.id)).toEqual(['rehab-a', 'rh', 'rehab-b', 'ct']);
    const rehabA = week.sessions[0].strength!;
    expect(rehabA.slots[0].exercises[0].planned.dose).toMatchObject({ sets: 3, intensity: { kind: 'rpe', min: 6, max: 6 } });
    expect(week.sessions[0].date).toBe('2026-10-05');
  });

  it('finder ugenummer for en dato', async () => {
    expect(await getWeekNoForDate(db, SIMON, '2026-10-07')).toBe(2);
    expect(await getWeekNoForDate(db, SIMON, '2027-02-01')).toBeNull();
  });

  it('skifter og ruller planversion tilbage', async () => {
    await addVersion(2);
    await activatePlanVersion(db, SIMON, 2);
    expect((await getActivePlan(db, SIMON)).meta.version).toBe(2);
    await activatePlanVersion(db, SIMON, 1);
    const versions = await listPlanVersions(db, SIMON);
    expect(versions.map((v) => [v.version, v.is_active])).toEqual([
      [2, false],
      [1, true],
    ]);
  });

  it('afviser ukendt version og andre atleters versioner', async () => {
    await expect(activatePlanVersion(db, SIMON, 9)).rejects.toThrow('Planversion 9 findes ikke');
    await expect(activatePlanVersion(db, w.karo.athleteId, 1)).rejects.toThrow('Planversion 1 findes ikke');
    await expect(getActivePlan(db, w.karo.athleteId)).rejects.toThrow('foreslaa_ny_plan');
  });

  it('versionsnumre er pr. atlet', async () => {
    const { plan } = await getActivePlan(db, SIMON);
    await db
      .prepare(`INSERT INTO plan_versions (athlete_id, version, created_at, source, plan_json, is_active) VALUES (?, 1, '2026-10-08T10:00:00.000Z', 'manual', ?, 1)`)
      .bind(w.karo.athleteId, JSON.stringify(plan))
      .run();
    expect((await listPlanVersions(db, w.karo.athleteId)).map((v) => v.version)).toEqual([1]);
    expect((await listPlanVersions(db, SIMON)).map((v) => v.version)).toEqual([1]);
  });
});

describe('API og login', () => {
  it('health kræver ikke login', async () => {
    expect((await call(w, null, '/api/health')).status).toBe(200);
  });

  it('afviser manglende og forkert session', async () => {
    expect((await call(w, null, '/api/a/simon/plan/active')).status).toBe(401);
    expect((await call(w, { ...w.simon, cookie: '__Host-tn_session=forkert' }, '/api/a/simon/plan/active')).status).toBe(401);
  });

  it('serverer planen med en gyldig session', async () => {
    const res = await call(w, w.simon, '/api/a/simon/plan/active');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { meta: { version: number } }).meta.version).toBe(1);
  });

  it('/api/me viser brugeren og atleterne', async () => {
    const me = (await (await call(w, w.simon, '/api/me')).json()) as { user: { name: string; isAdmin: boolean }; athletes: { slug: string; role: string }[] };
    expect(me.user).toMatchObject({ name: 'Simon', isAdmin: true });
    expect(me.athletes).toEqual([{ slug: 'simon', name: 'Simon', role: 'ejer' }]);
  });

  it('giver 404 for ukendt uge og 400 for ugyldigt ugenummer', async () => {
    expect((await call(w, w.simon, '/api/a/simon/plan/weeks/99')).status).toBe(404);
    expect((await call(w, w.simon, '/api/a/simon/plan/weeks/abc')).status).toBe(400);
  });

  it('log ud sletter sessionen', async () => {
    expect((await call(w, w.simon, '/api/auth/logout', { method: 'POST' })).headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect((await call(w, w.simon, '/api/me')).status).toBe(401);
  });
});
