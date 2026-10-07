import { Hono } from 'hono';
import { z } from 'zod';
import { Slug } from '../../shared/plan.schema';
import type { AppEnv } from '../env';
import { ValidationError } from '../services/errors';
import { exportAll, getExerciseHistory, getWeeklySummary } from '../services/history';

const parse = <T>(schema: z.ZodType<T>, v: unknown, what: string): T => {
  const r = schema.safeParse(v);
  if (!r.success) throw new ValidationError(`Ugyldig ${what}: ${String(v)}`);
  return r.data;
};

export const historyRoutes = new Hono<AppEnv>()
  .get('/exercises/:exerciseId', async (c) => {
    const limit = c.req.query('limit');
    return c.json(
      await getExerciseHistory(
        c.env.DB,
        parse(Slug, c.req.param('exerciseId'), 'øvelse'),
        limit ? parse(z.coerce.number().int().min(1), limit, 'limit') : undefined,
      ),
    );
  })
  .get('/weeks/:weekNo', async (c) => c.json(await getWeeklySummary(c.env.DB, parse(z.coerce.number().int().min(1), c.req.param('weekNo'), 'uge'))));

export const exportRoutes = new Hono<AppEnv>().get('/', async (c) => {
  const data = await exportAll(c.env.DB);
  return c.json(data, 200, { 'Content-Disposition': `attachment; filename="traeningsnav-eksport-${data.exportedAt.slice(0, 10)}.json"` });
});
