// Cast til TV. /api/a/:slug/cast (ejer, app-session): opret, opdatér og afslut. /api/cast (uden login): TV'et
// henter med det hemmelige token eller slår en kode op (begrænset pr. IP mod gæt).
import { Hono } from 'hono';
import { clientIp, ownerOnly } from '../auth';
import type { AppEnv } from '../env';
import { authAttemptStatus, recordAuthAttempt } from '../services/audit';
import { createCast, endCast, readCast, tokenForCode, updateCast } from '../services/cast';

export const castRoutes = new Hono<AppEnv>()
  .post('/', async (c) => c.json(await createCast(c.env.DB, ownerOnly(c).athleteId, await c.req.json())))
  .put('/:token', async (c) => c.json(await updateCast(c.env.DB, ownerOnly(c).athleteId, c.req.param('token'), await c.req.json())))
  .delete('/:token', async (c) => {
    await endCast(c.env.DB, ownerOnly(c).athleteId, c.req.param('token'));
    return c.json({ ok: true });
  });

export const publicCastRoutes = new Hono<AppEnv>()
  .get('/kode/:code', async (c) => {
    const ip = clientIp(c);
    const { allowed, retryAt } = await authAttemptStatus(c.env.DB, ip);
    if (!allowed) return c.json({ error: 'For mange forsøg. Vent lidt.', retryAt }, 429);
    const token = await tokenForCode(c.env.DB, c.req.param('code'));
    if (!token) {
      await recordAuthAttempt(c.env.DB, ip, 'cast-kode', false);
      return c.json({ error: 'Koden findes ikke. Tjek tallene på telefonen.' }, 404);
    }
    return c.json({ token });
  })
  .get('/:token', async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(await readCast(c.env.DB, c.req.param('token')));
  });
