// Det udvidede plan-format: valgfri raceDate og endDate, styrkefarve C/D, samme session flere gange
// i en uge og mobilitet morgen + aften. Gamle planer skal opføre sig som før.
import { beforeEach, describe, expect, it } from 'vitest';
import planJson from '../plan/plan.v1.json';
import { PlanSchema, type Plan } from '../shared/plan.schema';
import { warmupRound } from '../shared/mobility';
import { describePlanChange } from '../shared/planDiff';
import { ScheduleOverride, Workout } from '../shared/records.schema';
import { planEndDate } from '../shared/resolve';
import { assignToOccurrences, effectiveSessions, occurrenceKey } from '../shared/schedule';
import { buildEvents } from '../worker/calendar/feed';
import { callTool } from '../worker/mcp/tools';
import { getAthlete } from '../worker/services/athletes';
import { getWeeklySummary } from '../worker/services/history';
import { activatePlanVersion, getActivePlan } from '../worker/services/plan';
import { pullChanges, pushChanges } from '../worker/services/sync';
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

const events = (plan: Plan, workouts: Workout[] = [], overrides: ScheduleOverride[] = []) =>
  buildEvents({
    plan,
    planVersion: 1,
    planChangedAt: '2026-09-27T12:00:00.000Z',
    workouts,
    sets: [],
    painScores: [],
    monitors: [],
    overrides,
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

// ─── Samme session flere gange i en uge ─────────────────────────────────────

type RawWeek = { weekNo: number; sessions: { sessionId: string; day: number; label: string }[] };
/** Plan v1 med en ekstra forekomst af `sessionId` på `day` i uge 2. */
const twice = (sessionId: string, day: number, label: string) =>
  variant((p) => {
    (p.weeks as RawWeek[]).find((w) => w.weekNo === 2)!.sessions.push({ sessionId, day, label });
  });
const week2 = (plan: Plan) => plan.weeks.find((w) => w.weekNo === 2)!;

const TS = '2026-10-06T18:00:00.000Z';
let n = 0;
const workout = (fields: Partial<Workout>): Workout =>
  Workout.parse({
    uuid: `70000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    planned_session_id: null,
    plan_version: 1,
    week_no: 2,
    date: '2026-10-05',
    started_at: null,
    finished_at: TS,
    type: 'styrke',
    rpe: null,
    note: null,
    source: 'app',
    external_id: null,
    distance_km: null,
    duration_sec: null,
    avg_hr: null,
    updated_at: TS,
    ...fields,
  });
const move = (session_id: string, day: number, planned_day: number | null) =>
  ScheduleOverride.parse({ uuid: `71000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, week_no: 2, session_id, day, planned_day, updated_at: TS });

describe('samme session flere gange i en uge', () => {
  it('validerer på forskellige dage og afviser samme session to gange samme dag', () => {
    const plan = twice('rehab-a', 5, 'Rehab A (fredag)');
    expect(week2(plan).sessions.filter((s) => s.sessionId === 'rehab-a').map((s) => s.day)).toEqual([1, 5]);
    const raw = structuredClone(planJson) as unknown as { weeks: RawWeek[] };
    raw.weeks[1].sessions.push({ sessionId: 'rehab-a', day: 1, label: 'Rehab A igen' });
    expect(PlanSchema.safeParse(raw).error?.issues.map((i) => i.message)).toEqual(['Session rehab-a står to gange samme dag (dag 1) i uge 2']);
  });

  it('kobler træninger til forekomsten: planens dag først, gamle træninger uden dag til den første ledige', () => {
    const plan = twice('rehab-a', 5, 'Rehab A');
    const old = workout({ planned_session_id: 'rehab-a' }); // fra før gentagne sessioner
    const friday = workout({ planned_session_id: 'rehab-a', planned_day: 5, date: '2026-10-09' });
    const byOcc = assignToOccurrences(week2(plan), [friday, old], (w) => w.planned_session_id, (w) => w.planned_day);
    expect(byOcc.get(occurrenceKey('rehab-a', 1))).toEqual([old]);
    expect(byOcc.get(occurrenceKey('rehab-a', 5))).toEqual([friday]);
    // Står sessionen kun én gang, er planned_day ligegyldig (som før).
    const single = assignToOccurrences(week2(v1), [friday, old], (w) => w.planned_session_id, (w) => w.planned_day);
    expect(single.get(occurrenceKey('rehab-a', 1))).toEqual([friday, old]);
  });

  it('flytter kun den forekomst, flytningen gælder', () => {
    const plan = twice('rehab-a', 5, 'Rehab A');
    const s = effectiveSessions(week2(plan), [move('rehab-a', 7, 5)]).filter((x) => x.sessionId === 'rehab-a');
    expect(s.map((x) => [x.plannedDay, x.day, x.moved, x.repeated])).toEqual([
      [1, 1, false, true],
      [5, 7, true, true],
    ]);
    // En gammel flytning uden dag gælder den eneste forekomst, som før.
    expect(effectiveSessions(week2(v1), [move('rehab-a', 2, null)]).find((x) => x.sessionId === 'rehab-a')).toMatchObject({ day: 2, repeated: false });
  });

  it('kalenderen har et UID pr. forekomst med dagen, og de andre UID\'er er uændrede', () => {
    const plan = twice('rehab-a', 5, 'Rehab A');
    const e = events(plan, [workout({ planned_session_id: 'rehab-a', planned_day: 5, date: '2026-10-09' })]);
    const uids = e.map((x) => x.uid);
    expect(uids).toContain('rehab-a-uge2-d1@traeningsnav');
    expect(uids).toContain('rehab-a-uge2-d5@traeningsnav');
    expect(uids).not.toContain('rehab-a-uge2@traeningsnav');
    expect(new Set(uids).size).toBe(uids.length);
    // Kun rehab-a i uge 2 skifter UID; resten af kalenderen er den samme som for plan v1.
    const changed = (list: string[]) => list.filter((u) => u.startsWith('rehab-a-uge2'));
    expect(uids.filter((u) => !changed([u]).length).sort()).toEqual(events(v1).map((x) => x.uid).filter((u) => !changed([u]).length).sort());
    expect(e.find((x) => x.uid === 'rehab-a-uge2-d5@traeningsnav')).toMatchObject({ state: 'lavet', summary: '✓ Rehab A' });
    expect(e.find((x) => x.uid === 'rehab-a-uge2-d1@traeningsnav')!.state).not.toBe('lavet');
    expect(e.find((x) => x.uid === 'rehab-a-uge2-d5@traeningsnav')!.url).toBe('https://traeningsnav.test/session/rehab-a?uge=2&dag=5');
  });

  it('status pr. forekomst i ugeopsummeringen, hent_uge og hent_status', async () => {
    await install(twice('rehab-a', 3, 'Rehab A (onsdag)'));
    await pushChanges(db, SIMON, { workouts: [workout({ planned_session_id: 'rehab-a', planned_day: 1 })] });
    const summary = await getWeeklySummary(db, SIMON, 2, '2026-10-07');
    expect(summary.sessions.filter((s) => s.sessionId === 'rehab-a').map((s) => [s.plannedDay, s.status])).toEqual([
      [1, 'lavet'],
      [3, 'ikke-lavet'],
    ]);
    expect(summary).toMatchObject({ done: 1, planned: 5 });

    const uge = (await call('hent_uge', { uge: 2 })).json;
    const rehab = uge.sessioner.filter((s: { sessionId: string }) => s.sessionId === 'rehab-a');
    expect(rehab.map((s: { dag: string; planlagtDag: string; status: string }) => [s.dag, s.planlagtDag, s.status])).toEqual([
      ['man', 'man', 'lavet'],
      ['ons', 'ons', 'ikke-lavet'],
    ]);
    expect(rehab[0].lavet).toBeTruthy();
    expect(rehab[1].lavet).toBeUndefined();
    const status = (await call('hent_status')).json;
    expect(status.uge.iDag).toEqual([
      expect.objectContaining({ sessionId: 'rh', dag: 'ons' }),
      expect.objectContaining({ sessionId: 'rehab-a', dag: 'ons', planlagtDag: 'ons', status: 'ikke-lavet' }),
    ]);
    // Uden gentagelse står planlagtDag ikke i svaret.
    expect(uge.sessioner.find((s: { sessionId: string }) => s.sessionId === 'rh').planlagtDag).toBeUndefined();
  });

  it('log_lob knytter løbet til forekomsten på dagen, ellers den første ledige', async () => {
    await install(twice('rh', 1, 'RH mandag'));
    const log = (dato: string) => call('log_lob', { dato, distanceKm: 5, tid: '30:00', sessionId: 'rh' });
    expect((await log('2026-10-05')).ok).toBe(true); // mandag → forekomsten mandag
    expect((await log('2026-10-06')).ok).toBe(true); // tirsdag → første ledige: onsdag
    expect((await log('2026-10-07')).error).toBe('konflikt');
    const { changes } = await pullChanges(db, SIMON, null);
    expect(changes.workouts?.map((w) => [w.date, w.planned_day])).toEqual([
      ['2026-10-05', 1],
      ['2026-10-06', 3],
    ]);
    const uge = (await call('hent_uge', { uge: 2 })).json;
    expect(uge.sessioner.filter((s: { sessionId: string }) => s.sessionId === 'rh').map((s: { status: string }) => s.status)).toEqual(['lavet', 'lavet']);
  });

  it('planned_day synkes, og ældre poster uden feltet får null', async () => {
    await pushChanges(db, SIMON, {
      workouts: [workout({ planned_session_id: 'rh', planned_day: 3 })],
      schedule_overrides: [{ uuid: '72000000-0000-4000-8000-000000000001', week_no: 2, session_id: 'rh', day: 4, updated_at: TS }],
    });
    const { changes } = await pullChanges(db, SIMON, null);
    expect(changes.workouts?.[0].planned_day).toBe(3);
    expect(changes.schedule_overrides?.[0].planned_day).toBeNull();
  });

  it('diffen skelner forekomsterne', () => {
    const plan = twice('rehab-a', 5, 'Rehab A (fredag)');
    expect(describePlanChange(v1, plan)).toContain('Uge 2: + Rehab A (fre) "Rehab A (fredag)"');
    expect(describePlanChange(plan, v1)).toContain('Uge 2: − Rehab A (fre)');
    const relabeled = twice('rehab-a', 5, 'Ny tekst');
    expect(describePlanChange(plan, relabeled)).toEqual(['Uge 2: Rehab A (fre): "Rehab A (fredag)" → "Ny tekst"']);
  });
});

// ─── Mobilitet morgen og aften ──────────────────────────────────────────────

const withRounds = (schedule: string[] = ['morgen', 'aften']) =>
  variant((p) => {
    (p.mobility as { schedule?: string[] }).schedule = schedule;
  });
const ITEMS = v1.mobility!.items.map((i) => i.id);
let r = 0;
const roundCheck = (date: string, round: 'morgen' | 'aften', item_id: string, extra: Record<string, unknown> = {}) => ({
  uuid: `73000000-0000-4000-8000-${String(++r).padStart(12, '0')}`,
  date,
  round,
  item_id,
  done: true,
  updated_at: TS,
  ...extra,
});

describe('mobilitet morgen og aften', () => {
  it('schedule er valgfri; uden den er blokken én gang dagligt som før', () => {
    expect(v1.mobility!.schedule).toBeUndefined();
    expect(warmupRound(v1)).toBe(false);
    expect(withRounds().mobility!.schedule).toEqual(['morgen', 'aften']);
    expect(warmupRound(withRounds())).toBe(true);
    expect(warmupRound(withRounds(['aften']))).toBe(false);
    const raw = structuredClone(planJson) as { mobility: Record<string, unknown> };
    raw.mobility.schedule = ['morgen', 'morgen'];
    expect(PlanSchema.safeParse(raw).error?.issues.map((i) => i.message)).toEqual(['Samme runde står to gange i mobility.schedule']);
    raw.mobility.schedule = ['middag'];
    expect(PlanSchema.safeParse(raw).success).toBe(false);
  });

  it('afkrydsninger pr. dato og runde synkes og holdes pr. atlet', async () => {
    await pushChanges(db, SIMON, {
      mobility_round_checks: [roundCheck('2026-10-07', 'morgen', ITEMS[0]), roundCheck('2026-10-07', 'aften', ITEMS[0], { done: false })],
    });
    const { changes } = await pullChanges(db, SIMON, null);
    expect(changes.mobility_round_checks?.map((c) => [c.date, c.round, c.item_id, c.done])).toEqual([
      ['2026-10-07', 'morgen', ITEMS[0], true],
      ['2026-10-07', 'aften', ITEMS[0], false],
    ]);
    expect((await pullChanges(db, w.karo.athleteId, null)).changes.mobility_round_checks).toBeUndefined();
    await expect(pushChanges(db, SIMON, { mobility_round_checks: [roundCheck('2026-10-07', 'middag' as 'morgen', ITEMS[1])] })).rejects.toThrow('Ugyldig post');
  });

  it('ugeopsummeringen tæller runder og dage; slettede og ukendte punkter tæller ikke', async () => {
    await install(withRounds());
    await pushChanges(db, SIMON, {
      mobility_round_checks: [
        ...ITEMS.slice(0, 3).map((id) => roundCheck('2026-10-06', 'morgen', id)),
        roundCheck('2026-10-06', 'aften', ITEMS[0]),
        roundCheck('2026-10-07', 'aften', ITEMS[1], { deleted_at: TS }),
        roundCheck('2026-10-07', 'aften', 'ikke-i-planen'),
        roundCheck('2026-10-12', 'morgen', ITEMS[0]), // uge 3
      ],
      // En mobilitetsdag på den gamle måde tæller stadig med.
      workouts: [workout({ planned_session_id: 'mobilitet', type: 'mobilitet', date: '2026-10-05' })],
    });
    const summary = await getWeeklySummary(db, SIMON, 2, '2026-10-07');
    expect(summary.mobilityRounds).toEqual([
      { date: '2026-10-06', round: 'morgen', done: 3, total: ITEMS.length },
      { date: '2026-10-06', round: 'aften', done: 1, total: ITEMS.length },
    ]);
    expect(summary.mobilityDays).toBe(2);
  });

  it('MCP viser dagens runder, ugens runder og planens schedule', async () => {
    await install(withRounds());
    await pushChanges(db, SIMON, { mobility_round_checks: ITEMS.map((id) => roundCheck('2026-10-07', 'morgen', id)) });
    const status = (await call('hent_status')).json;
    expect(status.uge.mobilitetIDag).toEqual([
      { runde: 'morgen', lavet: `${ITEMS.length}/${ITEMS.length}` },
      { runde: 'aften', lavet: `0/${ITEMS.length}` },
    ]);
    expect((await call('hent_uge', { uge: 2 })).json.mobilitetsrunder).toEqual([{ dato: '2026-10-07', runde: 'morgen', lavet: `${ITEMS.length}/${ITEMS.length}` }]);
    expect((await call('hent_plan')).json.mobilitet.runder).toEqual(['morgen', 'aften']);
  });

  it('uden schedule er MCP-svarene som før', async () => {
    expect((await call('hent_status')).json.uge.mobilitetIDag).toBeUndefined();
    expect((await call('hent_uge', { uge: 2 })).json.mobilitetsrunder).toBeUndefined();
    expect((await call('hent_plan')).json.mobilitet.runder).toBe('én gang dagligt');
  });
});
