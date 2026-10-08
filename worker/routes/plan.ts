import { Hono } from 'hono';
import { z } from 'zod';
import { ownerOnly } from '../auth';
import type { AppEnv } from '../env';
import { ValidationError } from '../services/errors';
import { activatePlanVersion, findActivePlan, getWeek, listPlanVersions } from '../services/plan';

const positiveInt = (s: string, what: string) => {
  const r = z.coerce.number().int().min(1).safeParse(s);
  if (!r.success) throw new ValidationError(`Ugyldigt ${what}: ${s}`);
  return r.data;
};

export const planRoutes = new Hono<AppEnv>()
  // null når atleten ingen plan har endnu (appen venter så på det første forslag).
  .get('/active', async (c) => c.json(await findActivePlan(c.env.DB, c.var.access.athleteId)))
  .get('/versions', async (c) => c.json(await listPlanVersions(c.env.DB, c.var.access.athleteId)))
  .post('/versions/:version/activate', async (c) =>
    c.json(await activatePlanVersion(c.env.DB, ownerOnly(c).athleteId, positiveInt(c.req.param('version'), 'versionsnummer'))),
  )
  .get('/weeks/:weekNo', async (c) => c.json(await getWeek(c.env.DB, c.var.access.athleteId, positiveInt(c.req.param('weekNo'), 'ugenummer'))));
