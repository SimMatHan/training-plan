import { Hono } from 'hono';
import { z } from 'zod';
import { ownerOnly } from '../auth';
import type { AppEnv } from '../env';
import { listMcpAudit } from '../services/audit';
import { ValidationError } from '../services/errors';
import { approveProposal, getProposal, listProposals, PROPOSAL_STATUSES, rejectProposal } from '../services/proposals';

const id = (s: string) => {
  const r = z.uuid().safeParse(s);
  if (!r.success) throw new ValidationError(`Ugyldigt forslags-id: ${s}`);
  return r.data;
};

/** Claudes forslag. Træneren kan se dem; kun atleten selv kan godkende og afvise, og aldrig via MCP. */
export const proposalRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const status = c.req.query('status');
    const parsed = status ? z.enum(PROPOSAL_STATUSES).safeParse(status) : undefined;
    if (parsed && !parsed.success) throw new ValidationError(`Ugyldig status: ${status}`);
    return c.json(await listProposals(c.env.DB, c.var.access.athleteId, { status: parsed?.data }));
  })
  .get('/:id', async (c) => c.json(await getProposal(c.env.DB, c.var.access.athleteId, id(c.req.param('id')))))
  .post('/:id/approve', async (c) => c.json(await approveProposal(c.env.DB, ownerOnly(c).athleteId, id(c.req.param('id')))))
  .post('/:id/reject', async (c) => c.json(await rejectProposal(c.env.DB, ownerOnly(c).athleteId, id(c.req.param('id')))));

/** De seneste MCP-kald for atleten (værktøj, tidspunkt, udfald, hvem) til Indstillinger. */
export const mcpRoutes = new Hono<AppEnv>().get('/audit', async (c) => c.json(await listMcpAudit(c.env.DB, ownerOnly(c).athleteId, 20)));
