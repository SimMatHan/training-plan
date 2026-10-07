import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../worker/index';
import { activatePlanVersion, getActivePlan, getWeek, getWeekNoForDate, listPlanVersions } from '../worker/services/plan';
import { createSeededD1 } from './d1';

let db: D1Database;
beforeEach(async () => {
  db = await createSeededD1();
});

/** Indsætter en kopi af aktiv plan som ny version (som fase 3 vil gøre). */
async function addVersion(version: number) {
  const { plan } = await getActivePlan(db);
  await db
    .prepare(`INSERT INTO plan_versions (version, created_at, source, note, plan_json, is_active, based_on_version) VALUES (?, ?, 'manual', 'test', ?, 0, 1)`)
    .bind(version, '2026-10-08T10:00:00.000Z', JSON.stringify(plan))
    .run();
}

describe('plan-services (uden HTTP)', () => {
  it('henter aktiv plan fra seed', async () => {
    const { meta, plan } = await getActivePlan(db);
    expect(meta).toMatchObject({ version: 1, source: 'seed', is_active: true });
    expect(plan.weeks).toHaveLength(14);
  });

  it('getWeek giver sessioner med konkret dosering', async () => {
    const week = await getWeek(db, 2);
    expect(week.week.startDate).toBe('2026-10-05');
    expect(week.sessions.map((s) => s.session.id)).toEqual(['rehab-a', 'rh', 'rehab-b', 'ct']);
    const rehabA = week.sessions[0].strength!;
    expect(rehabA.slots[0].exercises[0].planned.dose).toMatchObject({ sets: 3, intensity: { kind: 'rpe', min: 6, max: 6 } });
    expect(week.sessions[0].date).toBe('2026-10-05');
  });

  it('finder ugenummer for en dato', async () => {
    expect(await getWeekNoForDate(db, '2026-10-07')).toBe(2);
    expect(await getWeekNoForDate(db, '2027-02-01')).toBeNull();
  });

  it('skifter og ruller planversion tilbage', async () => {
    await addVersion(2);
    await activatePlanVersion(db, 2);
    expect((await getActivePlan(db)).meta.version).toBe(2);
    await activatePlanVersion(db, 1);
    const versions = await listPlanVersions(db);
    expect(versions.map((v) => [v.version, v.is_active])).toEqual([
      [2, false],
      [1, true],
    ]);
  });

  it('afviser ukendt version', async () => {
    await expect(activatePlanVersion(db, 9)).rejects.toThrow('Planversion 9 findes ikke');
  });
});

describe('API og auth', () => {
  const env = () => ({ DB: db, API_TOKEN: 'hemmeligt-token', ASSETS: {} as Fetcher });
  const get = (path: string, token?: string) =>
    app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, env());

  it('health kræver ikke token', async () => {
    expect((await get('/api/health')).status).toBe(200);
  });

  it('afviser manglende og forkert token', async () => {
    expect((await get('/api/plan/active')).status).toBe(401);
    expect((await get('/api/plan/active', 'forkert')).status).toBe(401);
  });

  it('afviser alt hvis API_TOKEN ikke er sat', async () => {
    const res = await app.request('/api/plan/active', { headers: { Authorization: 'Bearer x' } }, { DB: db, ASSETS: {} as Fetcher });
    expect(res.status).toBe(401);
  });

  it('serverer planen med korrekt token', async () => {
    const res = await get('/api/plan/active', 'hemmeligt-token');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: { version: number } };
    expect(body.meta.version).toBe(1);
  });

  it('giver 404 for ukendt uge og 400 for ugyldigt ugenummer', async () => {
    expect((await get('/api/plan/weeks/99', 'hemmeligt-token')).status).toBe(404);
    expect((await get('/api/plan/weeks/abc', 'hemmeligt-token')).status).toBe(400);
  });
});
