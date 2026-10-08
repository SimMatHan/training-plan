import { beforeEach, describe, expect, it } from 'vitest';
import { applyPatch, PatchError } from '../shared/jsonPatch';
import { formatWeekList } from '../shared/planDiff';
import { callTool, serverInfo, TOOLS } from '../worker/mcp/tools';
import { getAthlete } from '../worker/services/athletes';
import { authAttemptStatus, listMcpAudit, recordAuthAttempt } from '../worker/services/audit';
import { activatePlanVersion as activate, getActivePlan as active, listPlanVersions as versions } from '../worker/services/plan';
import { approveProposal as approve, getProposal as get, listProposals as list, rejectProposal as reject } from '../worker/services/proposals';
import { pullChanges } from '../worker/services/sync';
import { isAllowedRedirect } from '../worker/oauth/redirects';
import { call as api, createWorld, type World } from './world';

let w: World;
let db: D1Database;
const NOW = new Date('2026-10-07T10:00:00.000Z');
const SIMON = 1;

beforeEach(async () => {
  w = await createWorld();
  db = w.db;
});

// Services for Simon (id 1), som før fase 5.
const getActivePlan = (d: D1Database) => active(d, SIMON);
const listPlanVersions = (d: D1Database) => versions(d, SIMON);
const activatePlanVersion = (d: D1Database, v: number) => activate(d, SIMON, v);
const listProposals = (d: D1Database, opts?: Parameters<typeof list>[2]) => list(d, SIMON, opts);
const getProposal = (d: D1Database, id: string) => get(d, SIMON, id);
const approveProposal = (d: D1Database, id: string, now?: string) => approve(d, SIMON, id, now);
const rejectProposal = (d: D1Database, id: string) => reject(d, SIMON, id);

/** Et værktøjskald via en forbindelse til `slug` (standard Simons egen). */
const callAs = async (slug: 'simon' | 'karo', role: 'ejer' | 'traener', name: string, args: unknown = {}) => {
  const athleteId = slug === 'simon' ? w.simon.athleteId : w.karo.athleteId;
  const userId = (slug === 'simon') === (role === 'ejer') ? w.simon.userId : w.karo.userId;
  const r = await callTool({ db, now: NOW, athlete: await getAthlete(db, athleteId), userId, role }, name, args);
  const json = JSON.parse(r.text);
  return { ...r, json, data: r.ok ? json : undefined };
};
const call = (name: string, args: unknown = {}) => callAs('simon', 'ejer', name, args);

// Enbens RDL i Styrke A, uge 9–10: 3 × 8/side.
const RDL_REPS = '/sessions/2/slots/0/variants/2/exercises/0/dose/reps';
const validPatch = [
  { op: 'test', path: '/sessions/2/slots/0/variants/2/exercises/0/exerciseId', value: 'enbens-rdl' },
  { op: 'replace', path: RDL_REPS, value: { min: 10, max: 10 } },
];
const propose = (patch: unknown = validPatch, summary = 'Enbens RDL 3 × 10 i uge 9–10') =>
  call('foreslaa_planaendring', { summary, rationale: 'Topvægten er ramt to gange i træk ved RPE 6.', patch });

describe('foreslaa_planaendring', () => {
  it('gemmer en gyldig patch som ventende og aktiverer intet', async () => {
    const r = await propose();
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ status: 'afventer', modVersion: 1 });
    expect(r.data.diff).toContain('Styrke A · Enbens RDL, uge 9–10: 3 × 8/side, RPE 7–8, pause 90 s → 3 × 10/side, RPE 7–8, pause 90 s');
    expect((await getActivePlan(db)).meta.version).toBe(1);
    expect(await listPlanVersions(db)).toHaveLength(1);
    expect(await listProposals(db, { status: 'afventer' })).toHaveLength(1);
  });

  it('afviser en patch der bryder plan-skemaet', async () => {
    const r = await propose([{ op: 'replace', path: '/weeks/0/startDate', value: '2026-09-29' }]);
    expect(r).toMatchObject({ ok: false, error: 'ugyldigt-input' });
    expect(r.text).toContain('plan-skemaet');
    expect(r.text).toContain('starter ikke en mandag');
    expect(await listProposals(db)).toHaveLength(0);
  });

  it('afviser en patch der ændrer et exerciseId', async () => {
    const r = await propose([{ op: 'replace', path: '/exercises/1/id', value: 'enbens-rdl-kb' }]);
    expect(r).toMatchObject({ ok: false, error: 'ugyldigt-input' });
    expect(r.json.fejl).toContain('exerciseId "enbens-rdl" (Enbens RDL) er fjernet eller omdøbt');
  });

  it('afviser at et id genbruges til en anden øvelse', async () => {
    const r = await propose([{ op: 'replace', path: '/exercises/1/name', value: 'Kettlebell swing' }]);
    expect(r.text).toContain('skifter betydning');
  });

  it('afviser et nyt id der har været brugt i loggen', async () => {
    await db
      .prepare(`INSERT INTO set_logs (uuid, athlete_id, workout_uuid, exercise_id, set_no, done, updated_at, server_updated_at) VALUES (?, 1, ?, 'gammel-oevelse', 1, 1, ?, ?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), NOW.toISOString(), NOW.toISOString())
      .run();
    const r = await propose([{ op: 'add', path: '/exercises/-', value: { id: 'gammel-oevelse', name: 'Ny ting', kind: 'weight_reps', perSide: false } }]);
    expect(r.text).toContain('har været brugt før');
  });

  it('tillader en ny øvelse med nyt id', async () => {
    const r = await propose([{ op: 'add', path: '/exercises/-', value: { id: 'step-up', name: 'Step-up', kind: 'weight_reps', perSide: true } }]);
    expect(r.ok).toBe(true);
    expect(r.data.diff).toContain('Ny øvelse: Step-up (step-up)');
  });

  it('afviser en patch der ikke kan anvendes, og for store patches', async () => {
    expect((await propose([{ op: 'remove', path: '/weeks/99' }])).text).toContain('kan ikke anvendes');
    const big = Array.from({ length: 150 }, () => ({ op: 'test', path: '/title', value: 'x'.repeat(400) }));
    expect((await propose(big)).text).toContain('større end 50 KB');
  });

  it('markerer forslag mod en ældre base som forældet, når en ny version aktiveres', async () => {
    const { id } = (await propose()).data;
    const { plan } = await getActivePlan(db);
    await db
      .prepare(`INSERT INTO plan_versions (athlete_id, version, created_at, source, note, plan_json, is_active) VALUES (1, 2, ?, 'manual', 'test', ?, 0)`)
      .bind(NOW.toISOString(), JSON.stringify(plan))
      .run();
    await activatePlanVersion(db, 2);
    expect((await getProposal(db, id)).status).toBe('forældet');
    await expect(approveProposal(db, id)).rejects.toThrow('allerede forældet');
  });

  it('markerer også forældet, når en version er indsat aktiv uden om appen', async () => {
    const { id } = (await propose()).data;
    const { plan } = await getActivePlan(db);
    await db.batch([
      db.prepare('UPDATE plan_versions SET is_active = 0'),
      db.prepare(`INSERT INTO plan_versions (athlete_id, version, created_at, source, plan_json, is_active) VALUES (1, 2, ?, 'manual', ?, 1)`).bind(NOW.toISOString(), JSON.stringify(plan)),
    ]);
    await expect(approveProposal(db, id)).rejects.toThrow();
    expect((await getProposal(db, id)).status).toBe('forældet');
  });
});

describe('godkend og afvis (appen)', () => {
  it('godkendelse laver en ny aktiv version fra Claude og gør de andre forslag forældede', async () => {
    const a = (await propose()).data.id;
    const b = (await propose([{ op: 'replace', path: '/title', value: 'Ny titel' }], 'Ny titel')).data.id;
    const approved = await approveProposal(db, a, '2026-10-07T11:00:00.000Z');
    expect(approved).toMatchObject({ status: 'godkendt', resultVersion: 2 });
    const { meta, plan } = await getActivePlan(db);
    expect(meta).toMatchObject({ version: 2, source: 'claude', note: 'Enbens RDL 3 × 10 i uge 9–10', based_on_version: 1, is_active: true });
    expect(plan.sessions[2].kind === 'styrke' && plan.sessions[2].slots[0].variants[2].exercises[0].dose.reps).toEqual({ min: 10, max: 10 });
    expect((await getProposal(db, b)).status).toBe('forældet');
    // Kalenderfeedet tæller skiftet med (activated_at).
    expect(await db.prepare('SELECT activated_at FROM plan_versions WHERE version = 2').first('activated_at')).toBe('2026-10-07T11:00:00.000Z');
  });

  it('afvisning ændrer intet i planen og kan ikke godkendes bagefter', async () => {
    const id = (await propose()).data.id;
    expect((await rejectProposal(db, id)).status).toBe('afvist');
    await expect(approveProposal(db, id)).rejects.toThrow('allerede afvist');
    expect((await getActivePlan(db)).meta.version).toBe(1);
  });

  it('API: kun atleten selv kan godkende, og kun med en session', async () => {
    const id = (await propose()).data.id;
    expect((await api(w, null, `/api/a/simon/proposals/${id}/approve`, { method: 'POST' })).status).toBe(401);
    const res = await api(w, w.simon, '/api/a/simon/proposals?status=afventer');
    const listed = (await res.json()) as { id: string; kind: string }[];
    expect(listed.map((p) => [p.id, p.kind])).toEqual([[id, 'patch']]);
    expect((await api(w, w.simon, `/api/a/simon/proposals/${id}/approve`, { method: 'POST' })).status).toBe(200);
    expect((await api(w, w.simon, `/api/a/simon/proposals/${id}/approve`, { method: 'POST' })).status).toBe(409);
    expect((await api(w, w.simon, '/api/a/simon/proposals/ikke-et-id')).status).toBe(400);
    // Simons forslag findes ikke for Karo.
    expect((await api(w, w.karo, `/api/a/karo/proposals/${id}`)).status).toBe(404);
  });
});

describe('ny plan og overvågning', () => {
  const plan = async () => structuredClone((await getActivePlan(db)).plan);

  it('Karo uden plan: patch henviser til foreslaa_ny_plan; en ny plan kan godkendes og logges mod', async () => {
    const r = await callAs('karo', 'ejer', 'foreslaa_planaendring', { summary: 'Ændring', rationale: 'x', patch: validPatch });
    expect(r.error).toBe('ugyldigt-input');
    expect(r.json.fejl).toContain('foreslaa_ny_plan');
    expect(r.json.atlet).toEqual({ slug: 'karo', navn: 'Karo' });

    const p = await plan();
    p.title = 'Karos første plan';
    const made = await callAs('karo', 'ejer', 'foreslaa_ny_plan', { summary: 'Første plan', rationale: 'Start', plan: p });
    expect(made.ok).toBe(true);
    expect(made.data.diff[0]).toBe('Ny plan: Karos første plan');
    expect(await list(db, w.karo.athleteId, { status: 'afventer' })).toHaveLength(1);
    expect(await listProposals(db)).toHaveLength(0);

    const approved = await approve(db, w.karo.athleteId, made.data.id);
    expect(approved).toMatchObject({ status: 'godkendt', resultVersion: 1, kind: 'ny-plan' });
    expect((await active(db, w.karo.athleteId)).plan.title).toBe('Karos første plan');
    expect((await getActivePlan(db)).plan.title).not.toBe('Karos første plan');
    expect((await callAs('karo', 'ejer', 'hent_status')).data.planversion).toBe(1);
  });

  it('en ny plan må ikke give et brugt exerciseId en ny betydning', async () => {
    const p = await plan();
    p.exercises[1] = { ...p.exercises[1], name: 'Noget andet' };
    const r = await call('foreslaa_ny_plan', { summary: 'Ny blok', rationale: 'x', plan: p });
    expect(r.json.fejl).toContain('har betydet Enbens RDL før');
    const bad = await call('foreslaa_ny_plan', { summary: 'Ny blok', rationale: 'x', plan: { title: 'x' } });
    expect(bad.json.fejl).toContain('plan-skemaet');
  });

  it('godkendes en ny plan, bliver andre ventende planforslag forældede', async () => {
    const patchId = (await propose()).data.id;
    const p = await plan();
    p.title = 'Blok 2';
    const nyId = (await call('foreslaa_ny_plan', { summary: 'Blok 2', rationale: 'x', plan: p })).data.id;
    const approved = await approveProposal(db, nyId);
    expect(approved.resultVersion).toBe(2);
    expect((await getProposal(db, patchId)).status).toBe('forældet');
    expect((await getActivePlan(db)).meta).toMatchObject({ version: 2, based_on_version: 1, source: 'claude' });
  });

  it('foreslaa_overvaagning tilføjer og deaktiverer monitors og tests, når det godkendes', async () => {
    const profil = (await call('hent_profil')).data;
    expect(profil.monitors).toEqual([{ id: 1, monitor: 'Venstre lyske', aktiv: true }]);
    const r = await call('foreslaa_overvaagning', {
      summary: 'Overvåg højre knæ',
      rationale: 'Ondt efter løb',
      ændringer: [
        { handling: 'tilfoej_monitor', label: 'Højre knæ' },
        { handling: 'tilfoej_test', navn: 'Sit and reach', enhed: 'cm', prSide: false },
        { handling: 'deaktiver_monitor', monitorId: 1 },
      ],
    });
    expect(r.data.diff).toEqual(['Ny smerteovervågning: Højre knæ', 'Ny mobilitetstest: Sit and reach (cm)', 'Stop smerteovervågning: Venstre lyske']);
    expect((await call('foreslaa_overvaagning', { summary: 'Fremmed', rationale: 'x', ændringer: [{ handling: 'deaktiver_monitor', monitorId: 99 }] })).error).toBe(
      'ugyldigt-input',
    );
    await approveProposal(db, r.data.id);
    const after = (await call('hent_profil')).data;
    expect(after.monitors).toEqual([
      { id: 1, monitor: 'Venstre lyske', aktiv: false },
      { id: 2, monitor: 'Højre knæ', aktiv: true },
    ]);
    expect(after.mobilitetstests.map((t: { navn: string }) => t.navn)).toEqual(['Knee-to-wall', 'Sit and reach']);
    // Planen er urørt.
    expect(await listPlanVersions(db)).toHaveLength(1);
  });
});

describe('læseværktøjer', () => {
  it('har danske beskrivelser og ingen sletning eller aktivering', () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      'hent_status',
      'hent_profil',
      'hent_plan',
      'hent_uge',
      'hent_ovelseshistorik',
      'list_ovelser',
      'hent_smertetrend',
      'hent_lysketrend',
      'hent_mobilitet',
      'hent_lob',
      'foreslaa_planaendring',
      'foreslaa_ny_plan',
      'foreslaa_overvaagning',
      'log_lob',
      'skriv_note',
    ]);
    expect(TOOLS.filter((t) => !t.readOnly).map((t) => t.name)).toEqual(['foreslaa_planaendring', 'foreslaa_ny_plan', 'foreslaa_overvaagning', 'log_lob', 'skriv_note']);
    expect(TOOLS.filter((t) => t.ownerOnly).map((t) => t.name)).toEqual(['log_lob']);
  });

  it('forbindelsen præsenterer sig med atletens navn', () => {
    expect(serverInfo({ name: 'Karo' }, 'traener')).toMatchObject({ name: 'Træningsnav – Karo' });
    expect(serverInfo({ name: 'Karo' }, 'traener').instructions).toContain('Denne forbindelse indeholder kun Karos træningsdata');
    expect(serverInfo({ name: 'Simon' }, 'ejer').instructions).toContain('kun Simons træningsdata');
  });

  it('hent_status kender ugen og dagens session', async () => {
    const r = await call('hent_status');
    expect(r.data).toMatchObject({ atlet: { slug: 'simon', navn: 'Simon' }, dato: '2026-10-07', ugedag: 'onsdag', uge: { nr: 2, afUger: 14, fase: 'Rehab' } });
    expect(Object.keys(r.data)[0]).toBe('atlet');
    expect(r.data.uge.iDag.map((s: { sessionId: string }) => s.sessionId)).toEqual(['rh']);
    expect(r.data.mobilitetstests).toEqual([{ test: 'Knee-to-wall', dageSidenSidste: 10, påmindelseEfterDage: 14, skalMåles: false }]);
  });

  it('hent_ovelseshistorik viser de seneste gange med sæt', async () => {
    const workout = crypto.randomUUID();
    const ts = NOW.toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO workouts (uuid, athlete_id, planned_session_id, plan_version, week_no, date, finished_at, type, updated_at, server_updated_at) VALUES (?, 1, 'rehab-a', 1, 2, '2026-10-05', ?, 'styrke', ?, ?)`,
        )
        .bind(workout, ts, ts, ts),
      ...['H', 'V'].map((side) =>
        db
          .prepare(`INSERT INTO set_logs (uuid, athlete_id, workout_uuid, exercise_id, set_no, side, weight_kg, reps, done, updated_at, server_updated_at) VALUES (?, 1, ?, 'enbens-rdl', 1, ?, 16, 8, 1, ?, ?)`)
          .bind(crypto.randomUUID(), workout, side, ts, ts),
      ),
    ]);
    const r = await call('hent_ovelseshistorik', { exerciseId: 'enbens-rdl', antal: 2 });
    expect(r.data.gange).toHaveLength(1);
    expect(r.data.gange[0]).toMatchObject({ dato: '2026-10-05', uge: 2, topKg: 16, klarTilMereVægt: false });
    expect(r.data.gange[0].sæt).toEqual([
      { nr: 1, side: 'H', kg: 16, reps: 8 },
      { nr: 1, side: 'V', kg: 16, reps: 8 },
    ]);
    expect((await call('hent_ovelseshistorik', { exerciseId: 'findes-ikke' })).error).toBe('ikke-fundet');
  });

  it('hent_plan giver stier, der kan bruges i en patch', async () => {
    const plan = (await call('hent_plan')).data;
    const variant = plan.sessioner[2].pladser[0].varianter[2];
    expect(variant).toMatchObject({ uger: '9–10', sti: '/sessions/2/slots/0/variants/2' });
    const raw = (await call('hent_plan', { sti: `${variant.sti}/exercises/0/exerciseId` })).data;
    expect(raw.json).toBe('enbens-rdl');
    expect((await call('hent_plan', { sti: '/findes/ikke' })).error).toBe('ikke-fundet');
  });

  it('hent_uge, hent_smertetrend, hent_mobilitet og hent_lob svarer', async () => {
    expect((await call('hent_uge', { uge: 2 })).data).toMatchObject({ uge: 2, fase: 'Rehab', løbeKm: 0 });
    expect((await call('hent_uge', { uge: 20 })).error).toBe('ikke-fundet');
    expect((await call('hent_uge', { uge: 99 })).error).toBe('ugyldigt-input');
    expect((await call('hent_mobilitet')).data.tests[0]).toMatchObject({ test: 'Knee-to-wall', enhed: 'cm', målinger: [{ dato: '2026-09-27', højre: 5, venstre: 7, forskel: 2 }] });
    expect((await call('hent_smertetrend')).data.monitors).toEqual([{ id: 1, monitor: 'Venstre lyske', aktiv: true }]);
    // Det gamle navn virker som alias.
    expect((await call('hent_lysketrend')).data.monitors).toEqual([{ id: 1, monitor: 'Venstre lyske', aktiv: true }]);
    expect((await call('hent_lob')).data).toEqual({ atlet: { slug: 'simon', navn: 'Simon' } });
  });

  it('hent_profil viser profil, plan og adgang', async () => {
    await db.prepare("INSERT INTO athlete_access (user_id, athlete_id, role, granted_at) VALUES (?, 1, 'traener', '2026-10-01T00:00:00.000Z')").bind(w.karo.userId).run();
    const p = (await call('hent_profil')).data;
    expect(p).toMatchObject({ navn: 'Simon', plan: { version: 1, uger: 14, start: '2026-09-28' } });
    expect(p.mobilitetstests[0]).toMatchObject({ navn: 'Knee-to-wall', enhed: 'cm', prSide: true, aktiv: true });
    expect(p.adgang).toEqual([
      { navn: 'Simon', rolle: 'ejer' },
      { navn: 'Karo', rolle: 'traener' },
    ]);
  });
});

describe('skriveværktøjer', () => {
  it('log_lob opretter et løb fra Claude knyttet til ugens session', async () => {
    const r = await call('log_lob', { dato: '2026-10-07', distanceKm: 6, tid: '33:00', puls: 142, rpe: 4, smerte: [{ monitorId: 1, score: 1 }], sessionId: 'rh' });
    expect(r.data.oprettet).toMatchObject({ dato: '2026-10-07', uge: 2, session: 'RH', distanceKm: 6, tid: '33:00', tempo: '5:30/km', kilde: 'claude' });
    expect(r.data.oprettet.smerte).toEqual([{ monitor: 'Venstre lyske', score: 1 }]);
    const { changes } = await pullChanges(db, SIMON, null);
    expect(changes.workouts?.[0]).toMatchObject({ source: 'claude', planned_session_id: 'rh', type: 'løb', week_no: 2 });
    expect(changes.pain_scores?.[0]).toMatchObject({ monitor_id: 1, kind: 'under', score: 1, workout_uuid: changes.workouts?.[0].uuid });
    expect((await call('log_lob', { dato: '2026-10-06', distanceKm: 5, tid: '30:00', smerte: [{ monitorId: 9, score: 1 }] })).text).toContain('Ukendt monitor');
    expect((await call('hent_uge', { uge: 2 })).data.løbeKm).toBe(6);
    // Samme session to gange giver konflikt; fremtidige datoer og forkert tid afvises.
    expect((await call('log_lob', { dato: '2026-10-07', distanceKm: 5, tid: '30:00', sessionId: 'rh' })).error).toBe('konflikt');
    expect((await call('log_lob', { dato: '2026-10-09', distanceKm: 5, tid: '30:00' })).text).toContain('fremtiden');
    expect((await call('log_lob', { distanceKm: 5, tid: '30 min' })).error).toBe('ugyldigt-input');
  });

  it('skriv_note opretter en note, der synkes til appen', async () => {
    const r = await call('skriv_note', { tekst: 'Husk knee-to-wall i morgen', sessionId: 'rehab-b' });
    expect(r.data).toMatchObject({ uge: 2, session: 'rehab-b' });
    const { changes } = await pullChanges(db, SIMON, null);
    expect(changes.coach_notes?.[0]).toMatchObject({ text: 'Husk knee-to-wall i morgen', week_no: 2, dismissed_at: null });
    expect((await call('skriv_note', { tekst: 'x', uge: 2, sessionId: 't1' })).error).toBe('ugyldigt-input');
  });
});

describe('revisionslog og rate limit', () => {
  it('logger hvert kald uden input-indhold', async () => {
    await call('hent_status');
    await call('skriv_note', { tekst: 'HEMMELIG-TEKST' });
    await call('hent_uge', { uge: 'abc' });
    await call('findes_ikke');
    const audit = await listMcpAudit(db, SIMON);
    expect(audit.map((a) => [a.tool, a.ok, a.error])).toEqual([
      ['ukendt', false, 'ikke-fundet'],
      ['hent_uge', false, 'ugyldigt-input'],
      ['skriv_note', true, null],
      ['hent_status', true, null],
    ]);
    const { results } = await db.prepare('SELECT * FROM mcp_audit').all();
    expect(JSON.stringify(results)).not.toContain('HEMMELIG');
  });

  it('revisionsloggen er pr. atlet og viser hvem der kaldte', async () => {
    await call('hent_status');
    await db.prepare("INSERT INTO athlete_access (user_id, athlete_id, role, granted_at) VALUES (?, ?, 'traener', '2026-10-01T00:00:00.000Z')").bind(w.simon.userId, w.karo.athleteId).run();
    await callAs('karo', 'traener', 'hent_profil');
    expect((await listMcpAudit(db, SIMON)).map((a) => [a.tool, a.user])).toEqual([['hent_status', 'Simon']]);
    expect((await listMcpAudit(db, w.karo.athleteId)).map((a) => [a.tool, a.user])).toEqual([['hent_profil', 'Simon']]);
  });

  it('rate limit: højst 10 login- og invitationsforsøg pr. IP pr. 15 minutter', async () => {
    const t = (min: number) => new Date(NOW.getTime() + min * 60_000);
    for (let i = 0; i < 9; i++) await recordAuthAttempt(db, '1.2.3.4', 'login', i % 2 === 0, t(i));
    expect((await authAttemptStatus(db, '1.2.3.4', t(9))).allowed).toBe(true);
    await recordAuthAttempt(db, '1.2.3.4', 'invite', false, t(9));
    const blocked = await authAttemptStatus(db, '1.2.3.4', t(10));
    expect(blocked).toEqual({ allowed: false, retryAt: t(15).toISOString() });
    expect((await authAttemptStatus(db, '5.6.7.8', t(10))).allowed).toBe(true);
    expect((await authAttemptStatus(db, '1.2.3.4', t(15.1))).allowed).toBe(true);
  });

  it('tillader kun claude.ai som redirect_uri (localhost kun når det er slået til)', () => {
    expect(isAllowedRedirect('https://claude.ai/api/mcp/auth_callback', false)).toBe(true);
    expect(isAllowedRedirect('https://claude.com/api/mcp/auth_callback', false)).toBe(true);
    expect(isAllowedRedirect('https://claude.ai/api/mcp/auth_callback?x=1', false)).toBe(false);
    expect(isAllowedRedirect('https://evil.example/api/mcp/auth_callback', false)).toBe(false);
    expect(isAllowedRedirect('http://localhost:6274/oauth/callback', false)).toBe(false);
    expect(isAllowedRedirect('http://localhost:6274/oauth/callback', true)).toBe(true);
  });
});

describe('JSON Patch', () => {
  const doc = { a: { b: [1, 2, 3] }, c: 'x' };

  it('anvender RFC 6902-operationerne på en kopi', () => {
    const out = applyPatch(doc, [
      { op: 'add', path: '/a/b/1', value: 9 },
      { op: 'remove', path: '/a/b/0' },
      { op: 'move', from: '/c', path: '/d' },
      { op: 'copy', from: '/a/b', path: '/e' },
      { op: 'test', path: '/d', value: 'x' },
      { op: 'add', path: '/a/b/-', value: 4 },
    ]);
    expect(out).toEqual({ a: { b: [9, 2, 3, 4] }, d: 'x', e: [9, 2, 3] });
    expect(doc).toEqual({ a: { b: [1, 2, 3] }, c: 'x' });
  });

  it('afviser prototype-nøgler og ukendte stier', () => {
    expect(() => applyPatch(doc, [{ op: 'add', path: '/__proto__/x', value: 1 }])).toThrow(PatchError);
    expect(() => applyPatch(doc, [{ op: 'add', path: '/a', value: JSON.parse('{"__proto__":{"x":1}}') }])).toThrow(PatchError);
    expect(() => applyPatch(doc, [{ op: 'replace', path: '/nope', value: 1 }])).toThrow('findes ikke');
    expect(() => applyPatch(doc, [{ op: 'test', path: '/c', value: 'y' }])).toThrow('test fejlede');
  });

  it('formaterer ugelister', () => {
    expect(formatWeekList([5, 6, 7, 8, 11, 12, 14])).toBe('5–8, 11–12, 14');
  });
});
