// Cast af en yogarutine til TV: telefonen (ejer) opretter og styrer, TV'et læser uden login.
import { beforeEach, describe, expect, it } from 'vitest';
import { call, createWorld, type World } from './world';

let w: World;
beforeEach(async () => {
  w = await createWorld();
});

const routine = { areas: ['hofter'], transitionSec: 6, poses: [{ poseId: 'due', seconds: 60 }] };
const state = { playing: false, elapsedMs: 0, tvSound: true };

async function create(who = w.simon) {
  const r = await call(w, who, `/api/a/${who.slug}/cast`, { method: 'POST', json: { title: 'Yoga · hofter', routine, state } });
  return { status: r.status, body: (await r.json()) as { token: string; code: string } };
}

describe('cast til TV', () => {
  it('ejeren opretter; TV’et slår koden op og følger tilstanden uden login', async () => {
    const { status, body } = await create();
    expect(status).toBe(200);
    expect(body.token).toMatch(/^[0-9a-f]{32}$/);
    expect(body.code).toMatch(/^\d{6}$/);

    const lookup = await call(w, null, `/api/cast/kode/${body.code}`, { origin: null });
    expect(await lookup.json()).toEqual({ token: body.token });

    const put = await call(w, w.simon, `/api/a/simon/cast/${body.token}`, { method: 'PUT', json: { playing: true, elapsedMs: 12_000, tvSound: false } });
    expect(put.status).toBe(200);

    const tv = await call(w, null, `/api/cast/${body.token}`, { origin: null });
    expect(tv.status).toBe(200);
    const view = (await tv.json()) as { title: string; state: unknown; routine: unknown; tvSeenAt: number; ended: boolean };
    expect(view).toMatchObject({ title: 'Yoga · hofter', state: { playing: true, elapsedMs: 12_000, tvSound: false }, routine, ended: false });
    expect(view.tvSeenAt).toBeGreaterThan(0);

    // Telefonen ser, at TV'et er der.
    const again = await call(w, w.simon, `/api/a/simon/cast/${body.token}`, { method: 'PUT', json: state });
    expect(((await again.json()) as { tvSeenAt: number | null }).tvSeenAt).toBeGreaterThan(0);

    await call(w, w.simon, `/api/a/simon/cast/${body.token}`, { method: 'DELETE' });
    expect(((await (await call(w, null, `/api/cast/${body.token}`, { origin: null })).json()) as { ended: boolean }).ended).toBe(true);
    expect((await call(w, null, `/api/cast/kode/${body.code}`, { origin: null })).status).toBe(404);
  });

  it('kun ejeren styrer, og kun sin egen cast', async () => {
    const { body } = await create();
    expect((await call(w, w.karo, `/api/a/karo/cast/${body.token}`, { method: 'PUT', json: state })).status).toBe(404);
    expect((await call(w, w.karo, `/api/a/simon/cast`, { method: 'POST', json: { title: 'x', routine, state } })).status).toBe(404);
    expect((await call(w, null, `/api/a/simon/cast`, { method: 'POST', json: { title: 'x', routine, state } })).status).toBe(401);
  });

  it('ukendte tokens og forkerte koder giver 404, og gæt begrænses', async () => {
    expect((await call(w, null, `/api/cast/${'0'.repeat(32)}`, { origin: null })).status).toBe(404);
    expect((await call(w, null, '/api/cast/ikke-et-token', { origin: null })).status).toBe(404);
    for (let i = 0; i < 10; i++) expect((await call(w, null, '/api/cast/kode/000000', { origin: null })).status).toBe(404);
    expect((await call(w, null, '/api/cast/kode/000000', { origin: null })).status).toBe(429);
  });

  it('afviser en ugyldig rutine', async () => {
    const r = await call(w, w.simon, '/api/a/simon/cast', { method: 'POST', json: { title: 'x', routine: { poses: [] }, state } });
    expect(r.status).toBe(400);
  });
});
