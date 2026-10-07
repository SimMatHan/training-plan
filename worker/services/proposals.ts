// Claudes forslag til planen. Et forslag er en JSON Patch mod den aktive planversion.
// Det valideres ved oprettelse og igen ved godkendelse, og det bliver aldrig aktivt af
// sig selv: kun approveProposal (kaldt fra appen) laver en ny planversion.
import { z } from 'zod';
import { applyPatch, JsonPatch, PatchError } from '../../shared/jsonPatch';
import { describePlanChange } from '../../shared/planDiff';
import { PlanSchema, type Plan } from '../../shared/plan.schema';
import { PROPOSAL_STATUSES, type Proposal, type ProposalStatus } from '../../shared/proposals';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { getActivePlan, getPlanVersion, listPlanVersions } from './plan';

export { PROPOSAL_STATUSES, type Proposal, type ProposalStatus };

/** Største tilladte patch (serialiseret JSON). */
export const MAX_PATCH_BYTES = 50_000;

export const ProposalInput = z.object({
  summary: z.string().trim().min(3).max(200),
  rationale: z.string().trim().min(1).max(4000),
  patch: JsonPatch,
});
export type ProposalInput = z.infer<typeof ProposalInput>;

interface ProposalRow {
  uuid: string;
  created_at: string;
  base_version: number;
  summary: string;
  rationale: string;
  patch_json: string;
  status: ProposalStatus;
  decided_at: string | null;
  result_version: number | null;
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Id'er brugt før: i alle planversioner og i loghistorikken. */
async function knownExerciseIds(db: D1Database): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const v of await listPlanVersions(db)) for (const e of (await getPlanVersion(db, v.version)).plan.exercises) ids.add(e.id);
  const { results } = await db.prepare('SELECT DISTINCT exercise_id FROM set_logs').all<{ exercise_id: string }>();
  for (const r of results) ids.add(r.exercise_id);
  return ids;
}

/**
 * Anvender patchen på basisplanen og tjekker resultatet:
 *  - patchen kan anvendes (RFC 6902) og er højst 50 KB
 *  - resultatet består plan-skemaet
 *  - intet exerciseId fra basisplanen forsvinder eller skifter betydning (navn, type, sidevis)
 *  - nye øvelser får id'er der aldrig har været brugt (i en planversion eller i loggen)
 */
export async function validatePatch(db: D1Database, base: Plan, patch: JsonPatch): Promise<{ plan: Plan; diff: string[] }> {
  if (byteLength(JSON.stringify(patch)) > MAX_PATCH_BYTES) throw new ValidationError(`Patchen er større end ${MAX_PATCH_BYTES / 1000} KB`);

  let patched: unknown;
  try {
    patched = applyPatch(base, patch);
  } catch (e) {
    if (e instanceof PatchError) throw new ValidationError(`Patchen kan ikke anvendes: ${e.message}`);
    throw e;
  }

  // Id-reglerne tjekkes før skemaet, så et omdøbt id giver den præcise fejl og ikke "Ukendt øvelse".
  const rawExercises = (patched as { exercises?: unknown }).exercises;
  const exercises = (Array.isArray(rawExercises) ? rawExercises : []).filter(
    (e): e is { id: string; name?: unknown; kind?: unknown; perSide?: unknown } => !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string',
  );
  const problems: string[] = [];
  for (const old of base.exercises) {
    const now = exercises.find((e) => e.id === old.id);
    if (!now) {
      problems.push(`exerciseId "${old.id}" (${old.name}) er fjernet eller omdøbt. Et id må aldrig ændres eller fjernes; tilføj en ny øvelse med et nyt id i stedet`);
      continue;
    }
    if (now.name !== old.name || now.kind !== old.kind || now.perSide !== old.perSide)
      problems.push(
        `exerciseId "${old.id}" skifter betydning (${old.name} → ${String(now.name)}). Et id må ikke genbruges til en anden øvelse; ` +
          'giv den nye øvelse et nyt id, eller brug "label" på den planlagte øvelse til et andet visningsnavn',
      );
  }
  const added = exercises.filter((e) => !base.exercises.some((b) => b.id === e.id));
  if (added.length) {
    const known = await knownExerciseIds(db);
    for (const e of added)
      if (known.has(e.id)) problems.push(`exerciseId "${e.id}" har været brugt før (i en planversion eller i loggen). Nye øvelser skal have nye id'er`);
  }
  if (problems.length) throw new ValidationError(problems.join('. '));

  const parsed = PlanSchema.safeParse(patched);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 8).map((i) => `${i.path.length ? '/' + i.path.join('/') : '(rod)'}: ${i.message}`);
    const more = parsed.error.issues.length > 8 ? ` (+${parsed.error.issues.length - 8} flere)` : '';
    throw new ValidationError(`Resultatet består ikke plan-skemaet: ${issues.join('; ')}${more}`);
  }
  const plan = parsed.data;

  return { plan, diff: describePlanChange(base, plan) };
}

/** Markerer ventende forslag mod en anden version end den aktive som forældede. */
export async function expireStaleProposals(db: D1Database, activeVersion: number, now = new Date().toISOString()): Promise<void> {
  await db
    .prepare("UPDATE plan_proposals SET status = 'forældet', decided_at = ? WHERE status = 'afventer' AND base_version <> ?")
    .bind(now, activeVersion)
    .run();
}

async function toProposal(db: D1Database, r: ProposalRow): Promise<Proposal> {
  let diff: string[];
  try {
    const { plan } = await getPlanVersion(db, r.base_version);
    const patch = JsonPatch.parse(JSON.parse(r.patch_json));
    diff = describePlanChange(plan, applyPatch(plan, patch));
  } catch {
    diff = ['(Ændringerne kan ikke vises)'];
  }
  return {
    id: r.uuid,
    createdAt: r.created_at,
    baseVersion: r.base_version,
    summary: r.summary,
    rationale: r.rationale,
    status: r.status,
    decidedAt: r.decided_at,
    resultVersion: r.result_version,
    diff,
  };
}

/** Gemmer et forslag som 'afventer' mod den aktive planversion. Aktiverer intet. */
export async function createProposal(db: D1Database, input: ProposalInput, now = new Date().toISOString()): Promise<Proposal> {
  const { summary, rationale, patch } = ProposalInput.parse(input);
  const { meta, plan } = await getActivePlan(db);
  const { diff } = await validatePatch(db, plan, patch);
  const row: ProposalRow = {
    uuid: crypto.randomUUID(),
    created_at: now,
    base_version: meta.version,
    summary,
    rationale,
    patch_json: JSON.stringify(patch),
    status: 'afventer',
    decided_at: null,
    result_version: null,
  };
  await db
    .prepare('INSERT INTO plan_proposals (uuid, created_at, base_version, summary, rationale, patch_json, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(row.uuid, row.created_at, row.base_version, row.summary, row.rationale, row.patch_json, row.status)
    .run();
  return { ...(await toProposal(db, row)), diff };
}

/** Forslag, nyeste først. Forældede markeres først, så listen altid passer til den aktive plan. */
export async function listProposals(db: D1Database, opts: { status?: ProposalStatus; limit?: number } = {}): Promise<Proposal[]> {
  const { meta } = await getActivePlan(db);
  await expireStaleProposals(db, meta.version);
  const where = opts.status ? 'WHERE status = ?' : '';
  const { results } = await db
    .prepare(`SELECT * FROM plan_proposals ${where} ORDER BY created_at DESC LIMIT ?`)
    .bind(...(opts.status ? [opts.status] : []), opts.limit ?? 50)
    .all<ProposalRow>();
  return Promise.all(results.map((r) => toProposal(db, r)));
}

async function getRow(db: D1Database, id: string): Promise<ProposalRow> {
  const row = await db.prepare('SELECT * FROM plan_proposals WHERE uuid = ?').bind(id).first<ProposalRow>();
  if (!row) throw new NotFoundError('Forslaget findes ikke');
  return row;
}

export async function getProposal(db: D1Database, id: string): Promise<Proposal> {
  const { meta } = await getActivePlan(db);
  await expireStaleProposals(db, meta.version);
  return toProposal(db, await getRow(db, id));
}

/**
 * Godkender et ventende forslag: ny planversion (source = 'claude', note = forslagets summary)
 * gøres aktiv, og alle andre ventende forslag bliver forældede. Alt i én batch (transaktion).
 */
export async function approveProposal(db: D1Database, id: string, now = new Date().toISOString()): Promise<Proposal> {
  const row = await getRow(db, id);
  if (row.status !== 'afventer') throw new ConflictError(`Forslaget er allerede ${row.status}`);
  const { meta } = await getActivePlan(db);
  if (meta.version !== row.base_version) {
    await expireStaleProposals(db, meta.version, now);
    throw new ConflictError(`Forslaget er lavet mod version ${row.base_version}, men version ${meta.version} er aktiv. Det er markeret som forældet`);
  }
  const { plan: base } = await getPlanVersion(db, row.base_version);
  const { plan } = await validatePatch(db, base, JsonPatch.parse(JSON.parse(row.patch_json)));
  const max = await db.prepare('SELECT MAX(version) AS v FROM plan_versions').first<number>('v');
  const version = (max ?? 0) + 1;
  // version er UNIQUE, så to samtidige godkendelser kan ikke begge lykkes.
  await db.batch([
    db.prepare('UPDATE plan_versions SET is_active = 0 WHERE is_active = 1'),
    db
      .prepare(
        "INSERT INTO plan_versions (version, created_at, source, note, plan_json, is_active, based_on_version, activated_at) VALUES (?, ?, 'claude', ?, ?, 1, ?, ?)",
      )
      .bind(version, now, row.summary, JSON.stringify(plan), row.base_version, now),
    db.prepare("UPDATE plan_proposals SET status = 'godkendt', decided_at = ?, result_version = ? WHERE uuid = ?").bind(now, version, id),
    db.prepare("UPDATE plan_proposals SET status = 'forældet', decided_at = ? WHERE status = 'afventer' AND uuid <> ?").bind(now, id),
  ]);
  return toProposal(db, await getRow(db, id));
}

export async function rejectProposal(db: D1Database, id: string, now = new Date().toISOString()): Promise<Proposal> {
  const row = await getRow(db, id);
  if (row.status !== 'afventer') throw new ConflictError(`Forslaget er allerede ${row.status}`);
  await db.prepare("UPDATE plan_proposals SET status = 'afvist', decided_at = ? WHERE uuid = ? AND status = 'afventer'").bind(now, id).run();
  return toProposal(db, await getRow(db, id));
}
