// Adskillelse mellem atleter (fase 5). Skal være grønne før deploy.
import { beforeEach, describe, expect, it } from 'vitest';
import { getActivePlan } from '../worker/services/plan';
import { pushChanges } from '../worker/services/sync';
import { call, createWorld, fetchWorker, ORIGIN, type Person, type World } from './world';

let w: World;
beforeEach(async () => {
  w = await createWorld();
});

const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const b64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Hele OAuth-flowet som claude.ai: registrering, samtykke med app-session, token til /mcp/<slug>. */
async function connect(who: Person, slug: string): Promise<string> {
  const reg = await fetchWorker(w, '/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none', client_name: 'Claude' }),
  });
  expect(reg.status).toBe(201);
  const { client_id } = (await reg.json()) as { client_id: string };
  const verifier = 'a'.repeat(64);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const resource = `${ORIGIN}/mcp/${slug}`;
  const q = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CLAUDE, state: 'st', code_challenge: challenge, code_challenge_method: 'S256', resource });
  const page = await fetchWorker(w, `/authorize?${q}`, { headers: { Cookie: who.cookie } });
  expect(page.status).toBe(200);
  const html = await page.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)![1];
  const consent = page.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const post = await fetchWorker(w, '/authorize', {
    method: 'POST',
    headers: { Cookie: `${who.cookie}; ${consent}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ handle, decision: 'approve' }),
  });
  expect(post.status).toBe(302);
  const code = new URL(post.headers.get('Location')!).searchParams.get('code')!;
  const tok = await fetchWorker(w, '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CLAUDE, client_id, code_verifier: verifier, resource }),
  });
  expect(tok.status).toBe(200);
  return ((await tok.json()) as { access_token: string }).access_token;
}

const rpc = (method: string, params: unknown = {}) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });

async function mcp(slug: string, token: string, method = 'tools/call', params: unknown = { name: 'hent_profil', arguments: {} }) {
  const res = await fetchWorker(w, `/mcp/${slug}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: rpc(method, params),
  });
  const body = await res.text();
  const json = body.startsWith('{') ? body : (body.match(/^data: (.*)$/m)?.[1] ?? '');
  return { status: res.status, json: json ? (JSON.parse(json) as { result?: { content?: { text: string }[]; isError?: boolean; serverInfo?: { name: string } } }) : null };
}

describe('appen (/api)', () => {
  it("Karos session kan hverken læse eller skrive Simons data (404)", async () => {
    for (const path of ['/plan/active', '/plan/versions', '/profile', '/sync/pull', '/history/exercises', '/proposals', '/trends/pain'])
      expect((await call(w, w.karo, `/api/a/simon${path}`)).status).toBe(404);
    const push = await call(w, w.karo, '/api/a/simon/sync/push', { method: 'POST', json: { changes: {} } });
    expect(push.status).toBe(404);
    expect((await call(w, w.karo, '/api/a/simon/plan/versions/1/activate', { method: 'POST' })).status).toBe(404);
    // Ukendt atlet ser ud som en atlet uden adgang.
    expect((await call(w, w.karo, '/api/a/findes-ikke/profile')).status).toBe(404);
    // Karos egne data er tilgængelige, og hun har ingen plan endnu.
    const own = await call(w, w.karo, '/api/a/karo/plan/active');
    expect(own.status).toBe(200);
    expect(await own.json()).toBeNull();
  });

  it('pull giver kun egne poster, og en post med fremmed uuid overskrives ikke', async () => {
    const workout = {
      uuid: '71000000-0000-4000-8000-000000000001',
      planned_session_id: null,
      plan_version: null,
      week_no: null,
      date: '2026-10-05',
      started_at: null,
      finished_at: null,
      type: 'cardio',
      rpe: null,
      note: 'Simons',
      source: 'app',
      external_id: null,
      distance_km: null,
      duration_sec: null,
      avg_hr: null,
      updated_at: '2026-10-05T10:00:00.000Z',
    };
    await pushChanges(w.db, w.simon.athleteId, { workouts: [workout] });
    // Karo prøver at overskrive Simons træning med en nyere version af samme uuid.
    const res = await call(w, w.karo, '/api/a/karo/sync/push', { method: 'POST', json: { changes: { workouts: [{ ...workout, note: 'Karos', updated_at: '2026-10-06T10:00:00.000Z' }] } } });
    expect(res.status).toBe(200);
    expect(await w.db.prepare('SELECT note, athlete_id FROM workouts WHERE uuid = ?').bind(workout.uuid).first()).toMatchObject({ note: 'Simons', athlete_id: w.simon.athleteId });
    const karoPull = (await (await call(w, w.karo, '/api/a/karo/sync/pull')).json()) as { changes: Record<string, unknown[]> };
    expect(karoPull.changes).toEqual({});
    const simonPull = (await (await call(w, w.simon, '/api/a/simon/sync/pull')).json()) as { changes: { workouts: { note: string }[] } };
    expect(simonPull.changes.workouts.map((x) => x.note)).toEqual(['Simons']);
  });

  it('en træner kan læse, men ikke godkende forslag, logge eller skifte plan', async () => {
    await w.db.prepare("INSERT INTO athlete_access (user_id, athlete_id, role, granted_at) VALUES (?, ?, 'traener', '2026-10-01T00:00:00.000Z')").bind(w.simon.userId, w.karo.athleteId).run();
    expect((await call(w, w.simon, '/api/a/karo/profile')).status).toBe(200);
    expect((await call(w, w.simon, '/api/a/karo/sync/push', { method: 'POST', json: { changes: {} } })).status).toBe(403);
    const id = '72000000-0000-4000-8000-000000000001';
    await w.db
      .prepare("INSERT INTO plan_proposals (uuid, athlete_id, kind, created_at, base_version, summary, rationale, patch_json, payload_json) VALUES (?, ?, 'overvaagning', ?, 0, 'Knæ', 'x', '[]', ?)")
      .bind(id, w.karo.athleteId, '2026-10-07T10:00:00.000Z', JSON.stringify({ changes: [{ handling: 'tilfoej_monitor', label: 'Højre knæ' }], diff: [] }))
      .run();
    expect((await call(w, w.simon, `/api/a/karo/proposals/${id}`)).status).toBe(200);
    expect((await call(w, w.simon, `/api/a/karo/proposals/${id}/approve`, { method: 'POST' })).status).toBe(403);
    expect((await call(w, w.karo, `/api/a/karo/proposals/${id}/approve`, { method: 'POST' })).status).toBe(200);
  });

  it('afviser mutationer fra et andet domæne og kald uden session', async () => {
    expect((await call(w, w.simon, '/api/a/simon/sync/push', { method: 'POST', json: { changes: {} }, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(w, w.simon, '/api/a/simon/sync/push', { method: 'POST', json: { changes: {} }, origin: null })).status).toBe(403);
    expect((await call(w, null, '/api/a/simon/plan/active')).status).toBe(401);
    expect((await call(w, null, '/api/me')).status).toBe(401);
  });
});

describe('MCP: én forbindelse pr. atlet', () => {
  it('et token til /mcp/karo afvises på /mcp/simon', async () => {
    const token = await connect(w.karo, 'karo');
    const own = await mcp('karo', token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(own.status).toBe(200);
    expect(own.json?.result?.serverInfo?.name).toBe('Træningsnav – Karo');
    expect((await mcp('simon', token)).status).toBe(401);
  });

  it('hvert svar starter med atleten, og Karos forbindelse ser kun Karos data', async () => {
    const token = await connect(w.karo, 'karo');
    const r = await mcp('karo', token, 'tools/call', { name: 'hent_status', arguments: {} });
    expect(r.status).toBe(200);
    const text = r.json!.result!.content![0].text;
    expect(text.startsWith('{"atlet":{"slug":"karo","navn":"Karo"}')).toBe(true);
    expect(text).toContain('Ingen aktiv plan');
    expect((await getActivePlan(w.db, w.simon.athleteId)).meta.version).toBe(1);
  });

  it('fjernes trænerrollen, fejler næste MCP-kald', async () => {
    await call(w, w.karo, '/api/a/karo/sharing', { method: 'GET' });
    await w.db.prepare("INSERT INTO athlete_access (user_id, athlete_id, role, granted_at) VALUES (?, ?, 'traener', '2026-10-01T00:00:00.000Z')").bind(w.simon.userId, w.karo.athleteId).run();
    const token = await connect(w.simon, 'karo');
    expect((await mcp('karo', token)).status).toBe(200);
    expect((await call(w, w.karo, `/api/a/karo/sharing/${w.simon.userId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await mcp('karo', token)).status).toBe(403);
  });

  it('en træner kan ikke logge løb via MCP', async () => {
    await w.db.prepare("INSERT INTO athlete_access (user_id, athlete_id, role, granted_at) VALUES (?, ?, 'traener', '2026-10-01T00:00:00.000Z')").bind(w.karo.userId, w.simon.athleteId).run();
    const token = await connect(w.karo, 'simon');
    const r = await mcp('simon', token, 'tools/call', { name: 'log_lob', arguments: { dato: '2026-10-07', distanceKm: 5, tid: '30:00' } });
    expect(r.json?.result?.isError).toBe(true);
    expect(r.json?.result?.content?.[0].text).toContain('ikke som træner');
    expect(await w.db.prepare('SELECT COUNT(*) AS n FROM workouts').first('n')).toBe(0);
  });

  it('samtykke kræver adgang og login; det gamle /mcp er væk', async () => {
    const q = new URLSearchParams({ response_type: 'code', client_id: 'x', redirect_uri: CLAUDE, state: 's', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', resource: `${ORIGIN}/mcp/simon` });
    const reg = await fetchWorker(w, '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none' }) });
    q.set('client_id', ((await reg.json()) as { client_id: string }).client_id);
    const anon = await fetchWorker(w, `/authorize?${q}`);
    expect(anon.status).toBe(302);
    expect(anon.headers.get('Location')).toMatch(/^\/login\?next=%2Fauthorize/);
    const karo = await fetchWorker(w, `/authorize?${q}`, { headers: { Cookie: w.karo.cookie } });
    expect(karo.status).toBe(403);
    const simon = await fetchWorker(w, `/authorize?${q}`, { headers: { Cookie: w.simon.cookie } });
    expect(await simon.text()).toContain('Simons</strong> træningsdata');
    expect((await fetchWorker(w, '/mcp', { method: 'POST' })).status).toBe(410);
  });
});
