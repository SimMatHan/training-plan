// Påmindelser (Web Push): VAPID-signaturen, hvilke dage der mindes, og cron-jobbet.
import { beforeEach, describe, expect, it } from 'vitest';
import { getActivePlan } from '../worker/services/plan';
import { getVapidKeys, mobilityDay, sendMorningReminders, vapidAuthorization } from '../worker/services/push';
import { call, createWorld, type World } from './world';

const APPLE = 'https://web.push.apple.com/QGxhYmVs';
// Uge 2: mandag 5/10 styrke (rehab-a), tirsdag 6/10 løb (rh). 6:00 dansk sommertid = 4:00 UTC.
const TUESDAY_6 = new Date('2026-10-06T04:00:00.000Z');
const MONDAY_6 = new Date('2026-10-05T04:00:00.000Z');

let w: World;
beforeEach(async () => {
  w = await createWorld();
});

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

describe('påmindelser', () => {
  it('laver én VAPID-nøgle og signerer en gyldig JWT', async () => {
    const keys = await getVapidKeys(w.db);
    expect((await getVapidKeys(w.db)).publicKey).toBe(keys.publicKey);
    const auth = await vapidAuthorization(APPLE, keys, 'https://traeningsnav.test', Date.parse('2026-10-06T04:00:00Z'));
    const [, jwt, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, sig] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(fromB64url(c)))).toMatchObject({ aud: 'https://web.push.apple.com', sub: 'https://traeningsnav.test' });
    const pub = await crypto.subtle.importKey('raw', fromB64url(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64url(sig), new TextEncoder().encode(`${h}.${c}`))).toBe(true);
  });

  it('minder kun om mobilitet på dage uden styrke, inden for planen', async () => {
    const { plan } = await getActivePlan(w.db, w.simon.athleteId);
    expect(mobilityDay(plan, '2026-10-05', [])).toBe(false);
    expect(mobilityDay(plan, '2026-10-06', [])).toBe(true);
    expect(mobilityDay(plan, '2030-01-01', [])).toBe(false);
  });

  it('cron sender kl. 6 dansk tid, én gang pr. dag, og fjerner udløbne abonnementer', async () => {
    expect((await call(w, w.simon, '/api/me/push', { method: 'POST', json: { endpoint: APPLE } })).status).toBe(200);
    expect(await (await call(w, w.simon, '/api/me/push/status', { method: 'POST', json: { endpoint: APPLE } })).json()).toEqual({ subscribed: true });
    const calls: string[] = [];
    const ok = (async (url: string) => (calls.push(url), new Response(null, { status: 201 }))) as unknown as typeof fetch;

    expect(await sendMorningReminders(w.db, 'https://traeningsnav.test', new Date('2026-10-06T05:00:00.000Z'), ok)).toEqual({ sendt: 0 }); // kl. 7
    expect(await sendMorningReminders(w.db, 'https://traeningsnav.test', MONDAY_6, ok)).toEqual({ sendt: 0 }); // styrkedag
    expect(await sendMorningReminders(w.db, 'https://traeningsnav.test', TUESDAY_6, ok)).toEqual({ sendt: 1 });
    expect(await sendMorningReminders(w.db, 'https://traeningsnav.test', TUESDAY_6, ok)).toEqual({ sendt: 0 });
    expect(calls).toEqual([APPLE]);

    const gone = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch;
    expect(await sendMorningReminders(w.db, 'https://traeningsnav.test', new Date('2026-10-07T04:00:00.000Z'), gone)).toEqual({ sendt: 0 });
    expect(await (await call(w, w.simon, '/api/me/push/status', { method: 'POST', json: { endpoint: APPLE } })).json()).toEqual({ subscribed: false });
  });

  it('afviser ukendte push-tjenester', async () => {
    expect((await call(w, w.simon, '/api/me/push', { method: 'POST', json: { endpoint: 'https://example.com/hook' } })).status).toBe(400);
  });
});
