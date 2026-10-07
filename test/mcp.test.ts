import { beforeEach, describe, expect, it } from 'vitest';
import { applyPatch, PatchError } from '../shared/jsonPatch';
import { formatWeekList } from '../shared/planDiff';
import { app } from '../worker/index';
import { callTool, TOOLS } from '../worker/mcp/tools';
import { authAttemptStatus, listMcpAudit, recordAuthAttempt } from '../worker/services/audit';
import { activatePlanVersion, getActivePlan, listPlanVersions } from '../worker/services/plan';
import { approveProposal, getProposal, listProposals, rejectProposal } from '../worker/services/proposals';
import { pullChanges } from '../worker/services/sync';
import { isAllowedRedirect } from '../worker/oauth/redirects';
import { createSeededD1 } from './d1';

let db: D1Database;
const NOW = new Date('2026-10-07T10:00:00.000Z');

beforeEach(async () => {
  db = await createSeededD1();
});

const call = async (name: string, args: unknown = {}) => {
  const r = await callTool(db, name, args, NOW);
  return { ...r, data: r.ok ? JSON.parse(r.text) : undefined };
};

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
    expect(r.text).toContain('exerciseId "enbens-rdl" (Enbens RDL) er fjernet eller omdøbt');
  });

  it('afviser at et id genbruges til en anden øvelse', async () => {
    const r = await propose([{ op: 'replace', path: '/exercises/1/name', value: 'Kettlebell swing' }]);
    expect(r.text).toContain('skifter betydning');
  });

  it('afviser et nyt id der har været brugt i loggen', async () => {
    await db
      .prepare(`INSERT INTO set_logs (uuid, workout_uuid, exercise_id, set_no, done, updated_at, server_updated_at) VALUES (?, ?, 'gammel-oevelse', 1, 1, ?, ?)`)
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
      .prepare(`INSERT INTO plan_versions (version, created_at, source, note, plan_json, is_active) VALUES (2, ?, 'manual', 'test', ?, 0)`)
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
      db.prepare(`INSERT INTO plan_versions (version, created_at, source, plan_json, is_active) VALUES (2, ?, 'manual', ?, 1)`).bind(NOW.toISOString(), JSON.stringify(plan)),
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

  it('API: kræver appens bearer-token', async () => {
    const id = (await propose()).data.id;
    const env = { DB: db, API_TOKEN: 'hemmeligt', ASSETS: {} as Fetcher };
    const req = (path: string, method = 'GET', token = 'hemmeligt') => app.request(path, { method, headers: { Authorization: `Bearer ${token}` } }, env);
    expect((await req(`/api/proposals/${id}/approve`, 'POST', 'forkert')).status).toBe(401);
    const list = (await (await req('/api/proposals?status=afventer')).json()) as { id: string; diff: string[] }[];
    expect(list.map((p) => p.id)).toEqual([id]);
    expect((await req(`/api/proposals/${id}/approve`, 'POST')).status).toBe(200);
    expect((await req(`/api/proposals/${id}/approve`, 'POST')).status).toBe(409);
    expect((await req('/api/proposals/ikke-et-id')).status).toBe(400);
  });
});

describe('læseværktøjer', () => {
  it('har danske beskrivelser og ingen sletning eller aktivering', () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      'hent_status',
      'hent_plan',
      'hent_uge',
      'hent_ovelseshistorik',
      'list_ovelser',
      'hent_lysketrend',
      'hent_mobilitet',
      'hent_lob',
      'foreslaa_planaendring',
      'log_lob',
      'skriv_note',
    ]);
    expect(TOOLS.filter((t) => !t.readOnly).map((t) => t.name)).toEqual(['foreslaa_planaendring', 'log_lob', 'skriv_note']);
  });

  it('hent_status kender ugen og dagens session', async () => {
    const r = await call('hent_status');
    expect(r.data).toMatchObject({ dato: '2026-10-07', ugedag: 'onsdag', uge: { nr: 2, afUger: 14, fase: 'Rehab' } });
    expect(r.data.uge.iDag.map((s: { sessionId: string }) => s.sessionId)).toEqual(['rh']);
    expect(r.data.kneeToWall.dageSidenSidste).toBe(10);
  });

  it('hent_ovelseshistorik viser de seneste gange med sæt', async () => {
    const workout = crypto.randomUUID();
    const ts = NOW.toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO workouts (uuid, planned_session_id, plan_version, week_no, date, finished_at, type, updated_at, server_updated_at) VALUES (?, 'rehab-a', 1, 2, '2026-10-05', ?, 'styrke', ?, ?)`,
        )
        .bind(workout, ts, ts, ts),
      ...['H', 'V'].map((side) =>
        db
          .prepare(`INSERT INTO set_logs (uuid, workout_uuid, exercise_id, set_no, side, weight_kg, reps, done, updated_at, server_updated_at) VALUES (?, ?, 'enbens-rdl', 1, ?, 16, 8, 1, ?, ?)`)
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

  it('hent_uge, hent_lysketrend, hent_mobilitet og hent_lob svarer', async () => {
    expect((await call('hent_uge', { uge: 2 })).data).toMatchObject({ uge: 2, fase: 'Rehab', løbeKm: 0 });
    expect((await call('hent_uge', { uge: 20 })).error).toBe('ikke-fundet');
    expect((await call('hent_uge', { uge: 99 })).error).toBe('ugyldigt-input');
    expect((await call('hent_mobilitet')).data.målinger[0]).toMatchObject({ dato: '2026-09-27', højre: 5, venstre: 7, forskel: 2 });
    expect((await call('hent_lysketrend')).data).toEqual([]);
    expect((await call('hent_lob')).data).toEqual([]);
  });
});

describe('skriveværktøjer', () => {
  it('log_lob opretter et løb fra Claude knyttet til ugens session', async () => {
    const r = await call('log_lob', { dato: '2026-10-07', distanceKm: 6, tid: '33:00', puls: 142, rpe: 4, lyske: 1, sessionId: 'rh' });
    expect(r.data.oprettet).toMatchObject({ dato: '2026-10-07', uge: 2, session: 'RH', distanceKm: 6, tid: '33:00', tempo: '5:30/km', kilde: 'claude' });
    const { changes } = await pullChanges(db, null);
    expect(changes.workouts?.[0]).toMatchObject({ source: 'claude', planned_session_id: 'rh', type: 'løb', week_no: 2 });
    expect((await call('hent_uge', { uge: 2 })).data.løbeKm).toBe(6);
    // Samme session to gange giver konflikt; fremtidige datoer og forkert tid afvises.
    expect((await call('log_lob', { dato: '2026-10-07', distanceKm: 5, tid: '30:00', sessionId: 'rh' })).error).toBe('konflikt');
    expect((await call('log_lob', { dato: '2026-10-09', distanceKm: 5, tid: '30:00' })).text).toContain('fremtiden');
    expect((await call('log_lob', { distanceKm: 5, tid: '30 min' })).error).toBe('ugyldigt-input');
  });

  it('skriv_note opretter en note, der synkes til appen', async () => {
    const r = await call('skriv_note', { tekst: 'Husk knee-to-wall i morgen', sessionId: 'rehab-b' });
    expect(r.data).toMatchObject({ uge: 2, session: 'rehab-b' });
    const { changes } = await pullChanges(db, null);
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
    const audit = await listMcpAudit(db);
    expect(audit.map((a) => [a.tool, a.ok, a.error])).toEqual([
      ['ukendt', false, 'ikke-fundet'],
      ['hent_uge', false, 'ugyldigt-input'],
      ['skriv_note', true, null],
      ['hent_status', true, null],
    ]);
    const { results } = await db.prepare('SELECT * FROM mcp_audit').all();
    expect(JSON.stringify(results)).not.toContain('HEMMELIG');
  });

  it('blokerer efter 5 forkerte kodeord på 15 minutter', async () => {
    const t = (min: number) => new Date(NOW.getTime() + min * 60_000);
    for (let i = 0; i < 4; i++) await recordAuthAttempt(db, false, t(i));
    expect((await authAttemptStatus(db, t(4))).allowed).toBe(true);
    await recordAuthAttempt(db, false, t(4));
    const blocked = await authAttemptStatus(db, t(5));
    expect(blocked).toEqual({ allowed: false, retryAt: t(15).toISOString() });
    expect((await authAttemptStatus(db, t(15.1))).allowed).toBe(true);
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
