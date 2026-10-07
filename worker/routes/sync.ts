import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { pullChanges, pushChanges, PushBody } from '../services/sync';

export const syncRoutes = new Hono<AppEnv>()
  .post('/push', async (c) => {
    const body = PushBody.parse(await c.req.json());
    return c.json(await pushChanges(c.env.DB, body.changes));
  })
  .get('/pull', async (c) => c.json(await pullChanges(c.env.DB, c.req.query('since') || null)));
