// Claudes forslag. Tre slags:
//   patch          JSON Patch mod den aktive planversion
//   ny-plan        en komplet plan (atletens første plan eller en ny blok)
//   overvaagning   tilføj/deaktivér monitors og mobilitetstests
// Et forslag valideres ved oprettelse og igen ved godkendelse, og det bliver aldrig aktivt af
// sig selv: kun approveProposal (kaldt fra appen af atleten selv) ændrer noget. Alt er pr. atlet.
import { z } from 'zod';
import { applyPatch, JsonPatch, PatchError } from '../../shared/jsonPatch';
import { describePlanChange, formatWeekList } from '../../shared/planDiff';
import { PlanSchema, type Plan } from '../../shared/plan.schema';
import { PROPOSAL_STATUSES, type Proposal, type ProposalKind, type ProposalStatus } from '../../shared/proposals';
import { listMobilityTests, listMonitors } from './athletes';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { findActivePlan, getActivePlan, getPlanVersion, listPlanVersions } from './plan';

export { PROPOSAL_STATUSES, type Proposal, type ProposalStatus };

/** Største tilladte patch (serialiseret JSON). */
export const MAX_PATCH_BYTES = 50_000;
/** Største tilladte komplette plan (serialiseret JSON). */
export const MAX_PLAN_BYTES = 300_000;

const Summary = z.string().trim().min(3).max(200);
const Rationale = z.string().trim().min(1).max(4000);

export const ProposalInput = z.object({ summary: Summary, rationale: Rationale, patch: JsonPatch });
export type ProposalInput = z.infer<typeof ProposalInput>;

export const NewPlanInput = z.object({ summary: Summary, rationale: Rationale, plan: z.unknown() });
export type NewPlanInput = z.infer<typeof NewPlanInput>;

export const MonitoringChange = z.discriminatedUnion('handling', [
  z.object({ handling: z.literal('tilfoej_monitor'), label: z.string().trim().min(1).max(40) }),
  z.object({ handling: z.literal('deaktiver_monitor'), monitorId: z.int().min(1) }),
  z.object({
    handling: z.literal('tilfoej_test'),
    navn: z.string().trim().min(1).max(40),
    enhed: z.string().trim().min(1).max(12),
    prSide: z.boolean(),
    instruktion: z.string().trim().max(1000).optional(),
  }),
  z.object({ handling: z.literal('deaktiver_test'), testId: z.int().min(1) }),
]);
export type MonitoringChange = z.infer<typeof MonitoringChange>;
export const MonitoringInput = z.object({ summary: Summary, rationale: Rationale, changes: z.array(MonitoringChange).min(1).max(10) });
export type MonitoringInput = z.infer<typeof MonitoringInput>;

interface ProposalRow {
  uuid: string;
  athlete_id: number;
  kind: ProposalKind;
  created_at: string;
  base_version: number;
  summary: string;
  rationale: string;
  patch_json: string;
  payload_json: string | null;
  status: ProposalStatus;
  decided_at: string | null;
  result_version: number | null;
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Id'er atleten har brugt før: i alle planversioner og i loghistorikken, med deres seneste definition. */
async function knownExercises(db: D1Database, athleteId: number): Promise<Map<string, { name: string; kind: string; perSide: boolean } | null>> {
  const known = new Map<string, { name: string; kind: string; perSide: boolean } | null>();
  const versions = await listPlanVersions(db, athleteId);
  for (const v of [...versions].reverse())
    for (const e of (await getPlanVersion(db, athleteId, v.version)).plan.exercises) known.set(e.id, { name: e.name, kind: e.kind, perSide: e.perSide });
  const { results } = await db.prepare('SELECT DISTINCT exercise_id FROM set_logs WHERE athlete_id = ?').bind(athleteId).all<{ exercise_id: string }>();
  for (const r of results) if (!known.has(r.exercise_id)) known.set(r.exercise_id, null);
  return known;
}

function schemaError(error: z.ZodError): ValidationError {
  const issues = error.issues.slice(0, 8).map((i) => `${i.path.length ? '/' + i.path.join('/') : '(rod)'}: ${i.message}`);
  const more = error.issues.length > 8 ? ` (+${error.issues.length - 8} flere)` : '';
  return new ValidationError(`Resultatet består ikke plan-skemaet: ${issues.join('; ')}${more}`);
}

/**
 * Anvender patchen på basisplanen og tjekker resultatet:
 *  - patchen kan anvendes (RFC 6902) og er højst 50 KB
 *  - resultatet består plan-skemaet
 *  - intet exerciseId fra basisplanen forsvinder eller skifter betydning (navn, type, sidevis)
 *  - nye øvelser får id'er der aldrig har været brugt (i en planversion eller i loggen)
 */
export async function validatePatch(db: D1Database, athleteId: number, base: Plan, patch: JsonPatch): Promise<{ plan: Plan; diff: string[] }> {
  if (byteLength(JSON.stringify(patch)) > MAX_PATCH_BYTES) throw new ValidationError(`Patchen er større end ${MAX_PATCH_BYTES / 1000} KB`);

  let patched: unknown;
  try {
    patched = applyPatch(base, patch);
  } catch (e) {
    if (e instanceof PatchError) throw new ValidationError(`Patchen kan ikke anvendes: ${e.message}`);
    throw e;
  }

  // Id-reglerne tjekkes før skemaet, så et omdøbt id giver den præcise fejl og ikke "Ukendt øvelse".
  const exercises = rawExercises(patched);
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
    const known = await knownExercises(db, athleteId);
    for (const e of added)
      if (known.has(e.id)) problems.push(`exerciseId "${e.id}" har været brugt før (i en planversion eller i loggen). Nye øvelser skal have nye id'er`);
  }
  if (problems.length) throw new ValidationError(problems.join('. '));

  const parsed = PlanSchema.safeParse(patched);
  if (!parsed.success) throw schemaError(parsed.error);
  return { plan: parsed.data, diff: describePlanChange(base, parsed.data) };
}

type RawExercise = { id: string; name?: unknown; kind?: unknown; perSide?: unknown };
function rawExercises(doc: unknown): RawExercise[] {
  const raw = (doc as { exercises?: unknown } | null)?.exercises;
  return (Array.isArray(raw) ? raw : []).filter(
    (e): e is RawExercise => !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string',
  );
}

/**
 * En komplet ny plan: højst 300 KB, består plan-skemaet, og et exerciseId der har været brugt før
 * (i en planversion eller loggen) må ikke skifte betydning. Gamle øvelser må gerne udgå.
 */
export async function validateNewPlan(db: D1Database, athleteId: number, raw: unknown): Promise<{ plan: Plan; diff: string[] }> {
  if (byteLength(JSON.stringify(raw) ?? '') > MAX_PLAN_BYTES) throw new ValidationError(`Planen er større end ${MAX_PLAN_BYTES / 1000} KB`);
  const known = await knownExercises(db, athleteId);
  const problems: string[] = [];
  for (const e of rawExercises(raw)) {
    const old = known.get(e.id);
    if (old && (old.name !== e.name || old.kind !== e.kind || old.perSide !== e.perSide))
      problems.push(`exerciseId "${e.id}" har betydet ${old.name} før. Et id må ikke genbruges til en anden øvelse; brug et nyt id`);
  }
  if (problems.length) throw new ValidationError(problems.join('. '));
  const parsed = PlanSchema.safeParse(raw);
  if (!parsed.success) throw schemaError(parsed.error);
  const plan = parsed.data;
  const active = await findActivePlan(db, athleteId);
  const intro = [
    `Ny plan: ${plan.title}`,
    `${plan.weeks.length} uger fra ${plan.startDate}, mål ${plan.raceDate}`,
    `Sessioner: ${plan.sessions.map((s) => s.name).join(', ')}`,
  ];
  if (!active) {
    const weeks = plan.weeks.map((w) => `Uge ${formatWeekList([w.weekNo])} (${w.phase}): ${w.sessions.map((s) => s.label).join(', ')}`);
    return { plan, diff: [...intro, ...weeks.slice(0, 20)] };
  }
  return { plan, diff: [...intro, `Ændringer i forhold til version ${active.meta.version}:`, ...describePlanChange(active.plan, plan)] };
}

async function describeMonitoring(db: D1Database, athleteId: number, changes: MonitoringChange[]): Promise<string[]> {
  const [monitors, tests] = await Promise.all([listMonitors(db, athleteId), listMobilityTests(db, athleteId)]);
  return changes.map((c) => {
    switch (c.handling) {
      case 'tilfoej_monitor':
        return `Ny smerteovervågning: ${c.label}`;
      case 'deaktiver_monitor': {
        const m = monitors.find((x) => x.id === c.monitorId);
        if (!m) throw new ValidationError(`Ukendt monitor: ${c.monitorId}. Brug hent_profil`);
        return `Stop smerteovervågning: ${m.label}`;
      }
      case 'tilfoej_test':
        return `Ny mobilitetstest: ${c.navn} (${c.enhed}${c.prSide ? ', højre og venstre' : ''})`;
      case 'deaktiver_test': {
        const t = tests.find((x) => x.id === c.testId);
        if (!t) throw new ValidationError(`Ukendt mobilitetstest: ${c.testId}. Brug hent_profil`);
        return `Stop mobilitetstest: ${t.name}`;
      }
    }
  });
}

/** Markerer ventende patch-forslag mod en anden version end den aktive som forældede. */
export async function expireStaleProposals(db: D1Database, athleteId: number, activeVersion: number, now = new Date().toISOString()): Promise<void> {
  await db
    .prepare("UPDATE plan_proposals SET status = 'forældet', decided_at = ? WHERE athlete_id = ? AND status = 'afventer' AND kind = 'patch' AND base_version <> ?")
    .bind(now, athleteId, activeVersion)
    .run();
}

async function toProposal(db: D1Database, r: ProposalRow): Promise<Proposal> {
  let diff: string[];
  try {
    if (r.kind === 'patch') {
      const { plan } = await getPlanVersion(db, r.athlete_id, r.base_version);
      diff = describePlanChange(plan, applyPatch(plan, JsonPatch.parse(JSON.parse(r.patch_json))));
    } else {
      diff = (JSON.parse(r.payload_json ?? '{}') as { diff?: string[] }).diff ?? [];
    }
  } catch {
    diff = ['(Ændringerne kan ikke vises)'];
  }
  return {
    id: r.uuid,
    kind: r.kind,
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

async function insertProposal(
  db: D1Database,
  athleteId: number,
  row: { kind: ProposalKind; base: number; summary: string; rationale: string; patch: unknown; payload: unknown },
  now: string,
): Promise<ProposalRow> {
  const r: ProposalRow = {
    uuid: crypto.randomUUID(),
    athlete_id: athleteId,
    kind: row.kind,
    created_at: now,
    base_version: row.base,
    summary: row.summary,
    rationale: row.rationale,
    patch_json: JSON.stringify(row.patch),
    payload_json: row.payload === null ? null : JSON.stringify(row.payload),
    status: 'afventer',
    decided_at: null,
    result_version: null,
  };
  await db
    .prepare(
      'INSERT INTO plan_proposals (uuid, athlete_id, kind, created_at, base_version, summary, rationale, patch_json, payload_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(r.uuid, r.athlete_id, r.kind, r.created_at, r.base_version, r.summary, r.rationale, r.patch_json, r.payload_json, r.status)
    .run();
  return r;
}

/** Gemmer et patch-forslag som 'afventer' mod den aktive planversion. Aktiverer intet. */
export async function createProposal(db: D1Database, athleteId: number, input: ProposalInput, now = new Date().toISOString()): Promise<Proposal> {
  const { summary, rationale, patch } = ProposalInput.parse(input);
  const active = await findActivePlan(db, athleteId);
  if (!active) throw new ValidationError('Atleten har ingen aktiv plan endnu. Brug foreslaa_ny_plan med en komplet plan');
  const { diff } = await validatePatch(db, athleteId, active.plan, patch);
  const row = await insertProposal(db, athleteId, { kind: 'patch', base: active.meta.version, summary, rationale, patch, payload: null }, now);
  return { ...(await toProposal(db, row)), diff };
}

/** Gemmer en komplet ny plan som forslag. Godkendes den, bliver den en ny aktiv planversion. */
export async function createNewPlanProposal(db: D1Database, athleteId: number, input: NewPlanInput, now = new Date().toISOString()): Promise<Proposal> {
  const { summary, rationale, plan: raw } = NewPlanInput.parse(input);
  const { plan, diff } = await validateNewPlan(db, athleteId, raw);
  const active = await findActivePlan(db, athleteId);
  const row = await insertProposal(db, athleteId, { kind: 'ny-plan', base: active?.meta.version ?? 0, summary, rationale, patch: [], payload: { plan, diff } }, now);
  return toProposal(db, row);
}

/** Gemmer ændringer af monitors og mobilitetstests som forslag. */
export async function createMonitoringProposal(db: D1Database, athleteId: number, input: MonitoringInput, now = new Date().toISOString()): Promise<Proposal> {
  const { summary, rationale, changes } = MonitoringInput.parse(input);
  const diff = await describeMonitoring(db, athleteId, changes);
  const active = await findActivePlan(db, athleteId);
  const row = await insertProposal(db, athleteId, { kind: 'overvaagning', base: active?.meta.version ?? 0, summary, rationale, patch: [], payload: { changes, diff } }, now);
  return toProposal(db, row);
}

async function expireAgainstActive(db: D1Database, athleteId: number, now?: string) {
  const active = await findActivePlan(db, athleteId);
  if (active) await expireStaleProposals(db, athleteId, active.meta.version, now);
}

/** Forslag, nyeste først. Forældede markeres først, så listen altid passer til den aktive plan. */
export async function listProposals(db: D1Database, athleteId: number, opts: { status?: ProposalStatus; limit?: number } = {}): Promise<Proposal[]> {
  await expireAgainstActive(db, athleteId);
  const { results } = await db
    .prepare(`SELECT * FROM plan_proposals WHERE athlete_id = ? ${opts.status ? 'AND status = ?' : ''} ORDER BY created_at DESC LIMIT ?`)
    .bind(athleteId, ...(opts.status ? [opts.status] : []), opts.limit ?? 50)
    .all<ProposalRow>();
  return Promise.all(results.map((r) => toProposal(db, r)));
}

async function getRow(db: D1Database, athleteId: number, id: string): Promise<ProposalRow> {
  const row = await db.prepare('SELECT * FROM plan_proposals WHERE athlete_id = ? AND uuid = ?').bind(athleteId, id).first<ProposalRow>();
  if (!row) throw new NotFoundError('Forslaget findes ikke');
  return row;
}

export async function getProposal(db: D1Database, athleteId: number, id: string): Promise<Proposal> {
  await expireAgainstActive(db, athleteId);
  return toProposal(db, await getRow(db, athleteId, id));
}

/** Indsætter en ny aktiv planversion fra Claude og afgør forslaget; andre ventende planforslag bliver forældede. */
async function activateNewVersion(db: D1Database, athleteId: number, row: ProposalRow, plan: Plan, basedOn: number | null, now: string) {
  const max = await db.prepare('SELECT MAX(version) AS v FROM plan_versions WHERE athlete_id = ?').bind(athleteId).first<number>('v');
  const version = (max ?? 0) + 1;
  // (athlete_id, version) er UNIQUE, så to samtidige godkendelser kan ikke begge lykkes.
  await db.batch([
    db.prepare('UPDATE plan_versions SET is_active = 0 WHERE athlete_id = ? AND is_active = 1').bind(athleteId),
    db
      .prepare(
        "INSERT INTO plan_versions (athlete_id, version, created_at, source, note, plan_json, is_active, based_on_version, activated_at) VALUES (?, ?, ?, 'claude', ?, ?, 1, ?, ?)",
      )
      .bind(athleteId, version, now, row.summary, JSON.stringify(plan), basedOn, now),
    db.prepare("UPDATE plan_proposals SET status = 'godkendt', decided_at = ?, result_version = ? WHERE uuid = ?").bind(now, version, row.uuid),
    db
      .prepare("UPDATE plan_proposals SET status = 'forældet', decided_at = ? WHERE athlete_id = ? AND status = 'afventer' AND kind <> 'overvaagning' AND uuid <> ?")
      .bind(now, athleteId, row.uuid),
  ]);
}

async function applyMonitoring(db: D1Database, athleteId: number, row: ProposalRow, changes: MonitoringChange[], now: string) {
  await describeMonitoring(db, athleteId, changes); // id'erne skal stadig tilhøre atleten
  const statements = changes.map((c) => {
    switch (c.handling) {
      case 'tilfoej_monitor':
        return db
          .prepare('INSERT INTO monitors (athlete_id, label, active, sort) SELECT ?, ?, 1, COALESCE(MAX(sort), -1) + 1 FROM monitors WHERE athlete_id = ?')
          .bind(athleteId, c.label, athleteId);
      case 'deaktiver_monitor':
        return db.prepare('UPDATE monitors SET active = 0 WHERE id = ? AND athlete_id = ?').bind(c.monitorId, athleteId);
      case 'tilfoej_test':
        return db
          .prepare('INSERT INTO mobility_tests (athlete_id, name, unit, per_side, active, instructions) VALUES (?, ?, ?, ?, 1, ?)')
          .bind(athleteId, c.navn, c.enhed, c.prSide ? 1 : 0, c.instruktion ?? null);
      case 'deaktiver_test':
        return db.prepare('UPDATE mobility_tests SET active = 0 WHERE id = ? AND athlete_id = ?').bind(c.testId, athleteId);
    }
  });
  await db.batch([...statements, db.prepare("UPDATE plan_proposals SET status = 'godkendt', decided_at = ? WHERE uuid = ?").bind(now, row.uuid)]);
}

/**
 * Godkender et ventende forslag. Patch og ny plan bliver en ny aktiv planversion (source = 'claude',
 * note = forslagets summary), og de andre ventende planforslag bliver forældede. Overvågning
 * tilføjer/deaktiverer monitors og tests. Alt i én batch (transaktion).
 */
export async function approveProposal(db: D1Database, athleteId: number, id: string, now = new Date().toISOString()): Promise<Proposal> {
  const row = await getRow(db, athleteId, id);
  if (row.status !== 'afventer') throw new ConflictError(`Forslaget er allerede ${row.status}`);
  if (row.kind === 'patch') {
    const { meta } = await getActivePlan(db, athleteId);
    if (meta.version !== row.base_version) {
      await expireStaleProposals(db, athleteId, meta.version, now);
      throw new ConflictError(`Forslaget er lavet mod version ${row.base_version}, men version ${meta.version} er aktiv. Det er markeret som forældet`);
    }
    const { plan: base } = await getPlanVersion(db, athleteId, row.base_version);
    const { plan } = await validatePatch(db, athleteId, base, JsonPatch.parse(JSON.parse(row.patch_json)));
    await activateNewVersion(db, athleteId, row, plan, row.base_version, now);
  } else if (row.kind === 'ny-plan') {
    const { plan } = await validateNewPlan(db, athleteId, (JSON.parse(row.payload_json ?? '{}') as { plan?: unknown }).plan);
    const active = await findActivePlan(db, athleteId);
    await activateNewVersion(db, athleteId, row, plan, active?.meta.version ?? null, now);
  } else {
    const { changes } = z.object({ changes: z.array(MonitoringChange) }).parse(JSON.parse(row.payload_json ?? '{}'));
    await applyMonitoring(db, athleteId, row, changes, now);
  }
  return toProposal(db, await getRow(db, athleteId, id));
}

export async function rejectProposal(db: D1Database, athleteId: number, id: string, now = new Date().toISOString()): Promise<Proposal> {
  const row = await getRow(db, athleteId, id);
  if (row.status !== 'afventer') throw new ConflictError(`Forslaget er allerede ${row.status}`);
  await db.prepare("UPDATE plan_proposals SET status = 'afvist', decided_at = ? WHERE athlete_id = ? AND uuid = ? AND status = 'afventer'").bind(now, athleteId, id).run();
  return toProposal(db, await getRow(db, athleteId, id));
}
