// Login med passkeys, invitationer, onboarding, deling og admin.
import { beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../worker/crypto';
import { createInvite, createSession, getSessionUser, SESSION_TTL_MS } from '../worker/services/users';
import { SoftAuthenticator } from './authenticator';
import { call, createWorld, ORIGIN, type Person, type World } from './world';

let w: World;
beforeEach(async () => {
  w = await createWorld();
});

const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
const cookieOf = (res: Response) => res.headers.get('Set-Cookie')!.split(';')[0];
const asCookie = (cookie: string): Person => ({ ...w.simon, cookie });

/** Opretter en passkey via invitationslinket, som appen gør. */
async function redeem(token: string, auth: SoftAuthenticator) {
  const { challengeId, options } = await json<{ challengeId: string; options: { challenge: string; rp: { id: string } } }>(
    await call(w, null, `/api/auth/invite/${token}/options`, { method: 'POST' }),
  );
  expect(options.rp.id).toBe('traeningsnav.test');
  return call(w, null, `/api/auth/invite/${token}/verify`, { method: 'POST', json: { challengeId, response: await auth.register(options), label: 'iPhone' } });
}

async function login(auth: SoftAuthenticator) {
  const { challengeId, options } = await json<{ challengeId: string; options: { challenge: string } }>(await call(w, null, '/api/auth/login/options', { method: 'POST' }));
  return call(w, null, '/api/auth/login/verify', { method: 'POST', json: { challengeId, response: await auth.login(options) } });
}

describe('invitation og passkey', () => {
  it('Simon gendanner adgang med et CLI-link, logger ind med passkey og ser sin egen atlet', async () => {
    const token = await createInvite(w.db, { name: 'Simon', isAdmin: true, userId: w.simon.userId, createdBy: null });
    expect(await json(await call(w, null, `/api/auth/invite/${token}`))).toEqual({ name: 'Simon', existingUser: true });
    const phone = await new SoftAuthenticator(ORIGIN).init();
    const reg = await redeem(token, phone);
    expect(reg.status).toBe(200);
    expect(reg.headers.get('Set-Cookie')).toMatch(/^__Host-tn_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax/);
    expect((await json<{ athletes: { slug: string }[] }>(reg)).athletes.map((a) => a.slug)).toEqual(['simon']);
    // Linket kan kun bruges én gang.
    expect((await call(w, null, `/api/auth/invite/${token}`)).status).toBe(404);

    const res = await login(phone);
    expect(res.status).toBe(200);
    const me = await json<{ user: { name: string } }>(await call(w, asCookie(cookieOf(res)), '/api/me'));
    expect(me.user.name).toBe('Simon');
    const keys = await json<{ label: string; lastUsedAt: string }[]>(await call(w, asCookie(cookieOf(res)), '/api/me/passkeys'));
    expect(keys).toMatchObject([{ label: 'iPhone' }]);
    // Den sidste passkey kan ikke slettes.
    expect((await call(w, asCookie(cookieOf(res)), `/api/me/passkeys/${(keys[0] as unknown as { id: number }).id}`, { method: 'DELETE' })).status).toBe(409);
  });

  it('en ny bruger får sin egen tomme atlet og vælger selv om inviteren må være træner', async () => {
    const token = await createInvite(w.db, { name: 'Line', isAdmin: false, createdBy: w.simon.userId });
    expect(await json(await call(w, null, `/api/auth/invite/${token}`))).toEqual({ name: 'Line', existingUser: false });
    const reg = await redeem(token, await new SoftAuthenticator(ORIGIN).init());
    const me = await json<{ user: { onboarded: boolean }; athletes: { slug: string; role: string }[] }>(reg);
    expect(me.user.onboarded).toBe(false);
    expect(me.athletes).toEqual([{ slug: 'line', name: 'Line', role: 'ejer' }]);
    const line = asCookie(cookieOf(reg));
    expect(await json(await call(w, line, '/api/a/line/plan/active'))).toBeNull();

    expect((await call(w, line, '/api/me/onboarding', { method: 'POST', json: { name: 'Line', thresholdHr: 172 } })).status).toBe(400);
    const done = await call(w, line, '/api/me/onboarding', { method: 'POST', json: { name: 'Line', thresholdHr: 172, coach: false } });
    expect((await json<{ user: { onboarded: boolean } }>(done)).user.onboarded).toBe(true);
    expect((await call(w, w.simon, '/api/a/line/profile')).status).toBe(404);

    // Senere under Indstillinger → Deling: Simon kan få trænerrollen og fjernes igen.
    const sharing = await json<{ candidates: { userId: number; name: string }[] }>(await call(w, line, '/api/a/line/sharing'));
    expect(sharing.candidates).toEqual([{ userId: w.simon.userId, name: 'Simon' }]);
    await call(w, line, '/api/a/line/sharing', { method: 'POST', json: { userId: w.simon.userId } });
    const profile = await json<{ role: string; athlete: { thresholdHr: number } }>(await call(w, w.simon, '/api/a/line/profile'));
    expect(profile).toMatchObject({ role: 'traener', athlete: { thresholdHr: 172 } });
    expect((await call(w, line, `/api/a/line/sharing/${w.simon.userId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(w, w.simon, '/api/a/line/profile')).status).toBe(404);
    // Ejerens egen adgang kan ikke fjernes; Simon kan ikke se Lines deling.
    const lineId = (await w.db.prepare("SELECT id FROM users WHERE name = 'Line'").first<number>('id'))!;
    expect((await call(w, line, `/api/a/line/sharing/${lineId}`, { method: 'DELETE' })).status).toBe(409);
    expect((await call(w, w.simon, '/api/a/line/sharing')).status).toBe(404);
  });

  it('onboarding med ja giver inviteren trænerrollen', async () => {
    const token = await createInvite(w.db, { name: 'Karoline', isAdmin: false, createdBy: w.simon.userId });
    const reg = await redeem(token, await new SoftAuthenticator(ORIGIN).init());
    await call(w, asCookie(cookieOf(reg)), '/api/me/onboarding', { method: 'POST', json: { name: 'Karoline', thresholdHr: null, coach: true } });
    const me = await json<{ athletes: { slug: string; role: string }[] }>(await call(w, w.simon, '/api/me'));
    expect(me.athletes.map((a) => [a.slug, a.role])).toEqual([
      ['simon', 'ejer'],
      ['karoline', 'traener'],
    ]);
  });

  it('afviser en passkey registreret til et andet domæne og ukendte passkeys', async () => {
    const token = await createInvite(w.db, { name: 'Ole', isAdmin: false, createdBy: null });
    const res = await redeem(token, await new SoftAuthenticator('https://evil.example', 'traeningsnav.test').init());
    expect(res.status).toBe(400);
    expect((await login(await new SoftAuthenticator(ORIGIN).init())).status).toBe(401);
  });
});

describe('sessioner og admin', () => {
  it('sessionen forlænges ved brug, højst én gang i døgnet, og udløber efter 90 dage', async () => {
    const t0 = Date.parse('2026-10-01T00:00:00Z');
    const id = await createSession(w.db, w.simon.userId, 'test', t0);
    const hash = await sha256Hex(id);
    const row = () => w.db.prepare('SELECT expires_at, last_seen_at FROM sessions WHERE id_hash = ?').bind(hash).first<{ expires_at: string; last_seen_at: string }>();
    await getSessionUser(w.db, id, t0 + 3_600_000);
    expect((await row())!.last_seen_at).toBe(new Date(t0).toISOString());
    await getSessionUser(w.db, id, t0 + 2 * 86_400_000);
    expect((await row())!.expires_at).toBe(new Date(t0 + 2 * 86_400_000 + SESSION_TTL_MS).toISOString());
    expect(await getSessionUser(w.db, id, t0 + 2 * 86_400_000 + SESSION_TTL_MS + 1)).toBeNull();
    // Kun hashen står i D1.
    expect(await w.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE id_hash = ?').bind(id).first('n')).toBe(0);
  });

  it('admin opretter invitationer; andre kan ikke', async () => {
    const res = await call(w, w.simon, '/api/admin/invites', { method: 'POST', json: { name: 'Karo', isAdmin: false } });
    expect((await json<{ url: string }>(res)).url).toMatch(/^https:\/\/traeningsnav\.test\/invite\/[A-Za-z0-9_-]{43}$/);
    expect((await call(w, w.karo, '/api/admin/invites', { method: 'POST', json: { name: 'X' } })).status).toBe(403);
    const users = await json<{ users: { name: string }[]; invites: { name: string }[] }>(await call(w, w.simon, '/api/admin/users'));
    expect(users.users.map((u) => u.name)).toEqual(['Simon', 'Karo']);
    expect(users.invites.map((i) => i.name)).toEqual(['Karo']);
  });

  it('rate limit på invitationslinks: 429 efter 10 forsøg fra samme IP', async () => {
    for (let i = 0; i < 10; i++) expect((await call(w, null, '/api/auth/invite/forkert')).status).toBe(404);
    const res = await call(w, null, '/api/auth/invite/forkert');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });
});
