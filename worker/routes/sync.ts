import { Hono } from 'hono';
import { ownerOnly } from '../auth';
import type { AppEnv } from '../env';
import { pullChanges, pushChanges, PushBody } from '../services/sync';

export const syncRoutes = new Hono<AppEnv>()
  // Kun atleten selv logger. Posterne gemmes altid på atleten i ruten.
  .post('/push', async (c) => {
    const { athleteId } = ownerOnly(c);
    const body = PushBody.parse(await c.req.json());
    return c.json(await pushChanges(c.env.DB, athleteId, body.changes));
  })
  .get('/pull', async (c) => c.json(await pullChanges(c.env.DB, c.var.access.athleteId, c.req.query('since') || null)));
