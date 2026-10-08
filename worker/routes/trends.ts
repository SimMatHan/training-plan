import { Hono } from 'hono';
import { IsoDate } from '../../shared/plan.schema';
import type { AppEnv } from '../env';
import { ValidationError } from '../services/errors';
import { getMobilityTrend, getPainTrend } from '../services/trends';

export const trendRoutes = new Hono<AppEnv>()
  .get('/pain', async (c) => {
    const from = c.req.query('from') ?? '0000-01-01';
    if (!IsoDate.safeParse(from).success) throw new ValidationError(`Ugyldig dato: ${from}`);
    return c.json(await getPainTrend(c.env.DB, c.var.access.athleteId, from));
  })
  .get('/mobility', async (c) => c.json(await getMobilityTrend(c.env.DB, c.var.access.athleteId)));
