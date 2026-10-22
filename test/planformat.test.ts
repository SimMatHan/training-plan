// Det udvidede plan-format: valgfri raceDate og endDate. Gamle planer skal opføre sig som før.
import { beforeEach, describe, expect, it } from 'vitest';
import planJson from '../plan/plan.v1.json';
import { PlanSchema, type Plan } from '../shared/plan.schema';
import { planEndDate } from '../shared/resolve';
import { buildEvents } from '../worker/calendar/feed';
import { callTool } from '../worker/mcp/tools';
import { getAthlete } from '../worker/services/athletes';
import { activatePlanVersion, getActivePlan } from '../worker/services/plan';
import { createWorld, type World } from './world';

const SIMON = 1;
const NOW = new Date('2026-10-07T10:00:00.000Z'); // onsdag i uge 2
const v1 = PlanSchema.parse(planJson);

/** Plan v1 med ændringer, valideret mod skemaet. */
const variant = (change: (p: Record<string, unknown>) => void): Plan => {
  const raw = structuredClone(planJson) as Record<string, unknown>;
  change(raw);
  return PlanSchema.parse(raw);
};
const noRace = () =>
  variant((p) => {
    delete p.raceDate;
  });

let w: World;
let db: D1Database;

/** Indsætter planen som Simons næste version og gør den aktiv. */
async function install(plan: Plan) {
  const max = (await db.prepare('SELECT MAX(version) AS v FROM plan_versions WHERE athlete_id = ?').bind(SIMON).first<number>('v')) ?? 0;
  await db
    .prepare(`INSERT INTO plan_versions (athlete_id, version, created_at, source, note, plan_json, is_active, based_on_version) VALUES (?, ?, ?, 'manual', 'test', ?, 0, ?)`)
    .bind(SIMON, max + 1, NOW.toISOString(), JSON.stringify(plan), max)
    .run();
  await activatePlanVersion(db, SIMON, max + 1);
}

const call = async (name: string, args: unknown = {}) => {
  const r = await callTool({ db, now: NOW, athlete: await getAthlete(db, SIMON), userId: w.simon.userId, role: 'ejer' }, name, args);
  return { ...r, json: JSON.parse(r.text) };
};

const events = (plan: Plan) =>
  buildEvents({
    plan,
    planVersion: 1,
    planChangedAt: '2026-09-27T12:00:00.000Z',
    workouts: [],
    sets: [],
    painScores: [],
    monitors: [],
    overrides: [],
    settings: [],
    origin: 'https://traeningsnav.test',
    now: NOW.getTime(),
  });

beforeEach(async () => {
  w = await createWorld();
  db = w.db;
});

describe('colorKey', () => {
  it('tager styrkefarverne C og D', () => {
    const plan = variant((p) => {
      const sessions = p.sessions as { id: string; colorKey: string }[];
      sessions.find((s) => s.id === 'styrke-a')!.colorKey = 'C';
      sessions.find((s) => s.id === 'styrke-b')!.colorKey = 'D';
    });
    expect(plan.sessions.filter((s) => s.colorKey === 'C' || s.colorKey === 'D').map((s) => s.id)).toEqual(['styrke-a', 'styrke-b']);
    const raw = structuredClone(planJson) as { sessions: { colorKey: string }[] };
    raw.sessions[0].colorKey = 'E';
    expect(PlanSchema.safeParse(raw).success).toBe(false);
  });
});

describe('raceDate og endDate', () => {
  it('plan v1 validerer uændret: raceDate bevares, og endDate kommer ikke til', () => {
    expect(v1.raceDate).toBe('2026-12-31');
    expect('endDate' in v1).toBe(false);
    expect(planEndDate(v1)).toBe('2027-01-03'); // søndag i uge 14, ikke løbsdagen
  });

  it('en plan uden raceDate validerer, og slutdatoen afledes af sidste uge eller endDate', () => {
    const plan = noRace();
    expect(plan.raceDate).toBeUndefined();
    expect(planEndDate(plan)).toBe('2027-01-03');
    expect(planEndDate(variant((p) => (p.endDate = '2026-12-31')))).toBe('2026-12-31');
  });

  it('afviser en endDate før start eller før sidste uge', () => {
    const bad = (endDate: string) => {
      const raw = { ...structuredClone(planJson), endDate };
      return PlanSchema.safeParse(raw).error?.issues.map((i) => i.message);
    };
    expect(bad('2026-09-01')).toEqual(['endDate ligger før startDate']);
    expect(bad('2026-12-01')).toEqual(['endDate ligger før sidste uge (2026-12-28)']);
    expect(bad('2026-12-28')).toBeUndefined();
  });

  it('kalenderen har intet løbsmål uden raceDate, men planens øvrige mål står der stadig', () => {
    expect(events(v1).filter((e) => e.uid === 'maal-loebet@traeningsnav')).toHaveLength(1);
    const plan = { ...noRace(), goals: [{ date: '2026-11-21', title: 'Gåtur 20 km' }] };
    const uids = events(plan).map((e) => e.uid);
    expect(uids).not.toContain('maal-loebet@traeningsnav');
    expect(uids).toContain('maal-2026-11-21-gaatur-20-km@traeningsnav');
    expect(uids.filter((u) => u.startsWith('maal-'))).toHaveLength(1);
  });

  it('hent_status, hent_profil og hent_plan svarer løbsdato: null uden at fejle', async () => {
    await install(variant((p) => (delete p.raceDate, (p.endDate = '2026-12-31'))));
    const status = await call('hent_status');
    expect(status.ok).toBe(true);
    expect(status.json).toMatchObject({ løbsdato: null, planSlut: '2026-12-31', uge: { nr: 2 } });
    const profil = await call('hent_profil');
    expect(profil.json.plan).toMatchObject({ løbsdato: null, slut: '2026-12-31' });
    const plan = await call('hent_plan');
    expect(plan.json).toMatchObject({ løbsdato: null, slut: '2026-12-31' });
  });

  it('med raceDate er svarene som før', async () => {
    expect((await call('hent_status')).json).toMatchObject({ løbsdato: '2026-12-31', planSlut: '2027-01-03' });
    expect((await call('hent_profil')).json.plan).toMatchObject({ løbsdato: '2026-12-31', slut: '2027-01-03' });
  });

  it('foreslaa_ny_plan tager en plan uden løb, og den kan godkendes', async () => {
    const plan = noRace();
    const r = await call('foreslaa_ny_plan', { summary: 'Blok uden løb', rationale: 'Lysken', plan });
    expect(r.ok).toBe(true);
    expect(r.json.diff[1]).toBe('14 uger fra 2026-09-28 til 2027-01-03');
    expect(r.json.diff).toContain('Løbsdato ændret');
    const { approveProposal } = await import('../worker/services/proposals');
    await approveProposal(db, SIMON, r.json.id);
    expect((await getActivePlan(db, SIMON)).plan.raceDate).toBeUndefined();
  });
});
