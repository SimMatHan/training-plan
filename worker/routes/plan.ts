import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ValidationError } from '../services/errors';
import { activatePlanVersion, getActivePlan, getWeek, listPlanVersions } from '../services/plan';

const positiveInt = (s: string, what: string) => {
  const r = z.coerce.number().int().min(1).safeParse(s);
  if (!r.success) throw new ValidationError(`Ugyldigt ${what}: ${s}`);
  return r.data;
};

export const planRoutes = new Hono<AppEnv>()
  .get('/active', async (c) => c.json(await getActivePlan(c.env.DB)))
  .get('/versions', async (c) => c.json(await listPlanVersions(c.env.DB)))
  .post('/versions/:version/activate', async (c) => c.json(await activatePlanVersion(c.env.DB, positiveInt(c.req.param('version'), 'versionsnummer'))))
  .get('/weeks/:weekNo', async (c) => c.json(await getWeek(c.env.DB, positiveInt(c.req.param('weekNo'), 'ugenummer'))));
