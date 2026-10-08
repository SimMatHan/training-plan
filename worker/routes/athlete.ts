// /api/a/:slug/* — alt om én atlet. athleteAccess (worker/auth.ts) slår adgangen op først:
// ingen adgang giver 404; handlinger der ændrer noget kræver ejer (ownerOnly).
import { Hono } from 'hono';
import { z } from 'zod';
import { athleteAccess, ownerOnly } from '../auth';
import type { AppEnv } from '../env';
import {
  addMobilityTest,
  addMonitor,
  assertPositiveId,
  getProfile,
  getSharing,
  grantCoach,
  revokeAccess,
  updateAthlete,
  updateMobilityTest,
  updateMonitor,
} from '../services/athletes';
import { calendarRoutes } from './calendar';
import { exportRoutes, historyRoutes } from './history';
import { planRoutes } from './plan';
import { mcpRoutes, proposalRoutes } from './proposals';
import { syncRoutes } from './sync';
import { trendRoutes } from './trends';

const profileRoutes = new Hono<AppEnv>()
  .get('/profile', async (c) => c.json(await getProfile(c.env.DB, c.var.access)))
  .patch('/profile', async (c) => {
    const access = ownerOnly(c);
    const athlete = await updateAthlete(c.env.DB, access.athleteId, await c.req.json());
    return c.json(await getProfile(c.env.DB, { ...access, athlete }));
  })
  .post('/monitors', async (c) => c.json(await addMonitor(c.env.DB, ownerOnly(c).athleteId, await c.req.json())))
  .patch('/monitors/:id', async (c) =>
    c.json(await updateMonitor(c.env.DB, ownerOnly(c).athleteId, assertPositiveId(c.req.param('id'), 'monitor-id'), await c.req.json())),
  )
  .post('/mobility-tests', async (c) => c.json(await addMobilityTest(c.env.DB, ownerOnly(c).athleteId, await c.req.json())))
  .patch('/mobility-tests/:id', async (c) =>
    c.json(await updateMobilityTest(c.env.DB, ownerOnly(c).athleteId, assertPositiveId(c.req.param('id'), 'test-id'), await c.req.json())),
  )
  // Indstillinger → Deling: hvem har adgang til min træning.
  .get('/sharing', async (c) => {
    const { athleteId, userId } = ownerOnly(c);
    return c.json(await getSharing(c.env.DB, athleteId, userId));
  })
  .post('/sharing', async (c) => {
    const { athleteId, userId } = ownerOnly(c);
    const { userId: coach } = z.object({ userId: z.int().min(1) }).parse(await c.req.json());
    await grantCoach(c.env.DB, athleteId, userId, coach);
    return c.json(await getSharing(c.env.DB, athleteId, userId));
  })
  .delete('/sharing/:userId', async (c) => {
    const { athleteId, userId } = ownerOnly(c);
    await revokeAccess(c.env.DB, athleteId, assertPositiveId(c.req.param('userId'), 'bruger-id'));
    return c.json(await getSharing(c.env.DB, athleteId, userId));
  });

export const athleteRoutes = new Hono<AppEnv>()
  .use('*', athleteAccess)
  .route('/', profileRoutes)
  .route('/plan', planRoutes)
  .route('/sync', syncRoutes)
  .route('/trends', trendRoutes)
  .route('/history', historyRoutes)
  .route('/export', exportRoutes)
  .route('/calendar', calendarRoutes)
  .route('/proposals', proposalRoutes)
  .route('/mcp', mcpRoutes);
