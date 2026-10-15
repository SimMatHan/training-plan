// Planen redigeret i appen af atleten selv: den redigerede plan bliver en ny aktiv version
// (source = 'manual'), med de samme id-regler som Claudes forslag. Tidligere versioner bevares,
// så der kan rulles tilbage under Indstillinger → Plan.
import { z } from 'zod';
import type { Plan } from '../../shared/plan.schema';
import type { PlanVersionMeta } from '../../shared/records.schema';
import { ConflictError, ValidationError } from './errors';
import { getActivePlan, getPlanVersion } from './plan';
import { MAX_PLAN_BYTES, validateDerivedPlan } from './proposals';

export const PlanEditInput = z.object({
  /** Den version redigeringen tog udgangspunkt i. Er en anden aktiv nu, afvises gemningen. */
  baseVersion: z.int().min(1),
  note: z.string().trim().max(200).optional(),
  plan: z.unknown(),
});
export type PlanEditInput = z.infer<typeof PlanEditInput>;

export async function savePlanEdit(
  db: D1Database,
  athleteId: number,
  raw: unknown,
  now = new Date().toISOString(),
): Promise<{ meta: PlanVersionMeta; plan: Plan; diff: string[] }> {
  const parsedInput = PlanEditInput.safeParse(raw);
  if (!parsedInput.success) throw new ValidationError('Ugyldig redigering: baseVersion og plan skal med');
  const input = parsedInput.data;
  if (new TextEncoder().encode(JSON.stringify(input.plan) ?? '').length > MAX_PLAN_BYTES)
    throw new ValidationError(`Planen er større end ${MAX_PLAN_BYTES / 1000} KB`);

  const active = await getActivePlan(db, athleteId);
  if (active.meta.version !== input.baseVersion)
    throw new ConflictError(`Planen er ændret i mellemtiden: version ${active.meta.version} er aktiv, men du redigerede version ${input.baseVersion}. Hent planen igen`);

  const { plan, diff } = await validateDerivedPlan(db, athleteId, active.plan, input.plan);
  if (JSON.stringify(plan) === JSON.stringify(active.plan)) throw new ValidationError('Ingen ændringer at gemme');

  const max = await db.prepare('SELECT MAX(version) AS v FROM plan_versions WHERE athlete_id = ?').bind(athleteId).first<number>('v');
  const version = (max ?? 0) + 1;
  // (athlete_id, version) er UNIQUE, så to samtidige gemninger kan ikke begge lykkes.
  await db.batch([
    db.prepare('UPDATE plan_versions SET is_active = 0 WHERE athlete_id = ? AND is_active = 1').bind(athleteId),
    db
      .prepare(
        "INSERT INTO plan_versions (athlete_id, version, created_at, source, note, plan_json, is_active, based_on_version, activated_at) VALUES (?, ?, ?, 'manual', ?, ?, 1, ?, ?)",
      )
      .bind(athleteId, version, now, input.note || 'Rettet i appen', JSON.stringify(plan), input.baseVersion, now),
    // Claudes ventende planforslag er lavet mod den gamle version.
    db
      .prepare("UPDATE plan_proposals SET status = 'forældet', decided_at = ? WHERE athlete_id = ? AND status = 'afventer' AND kind <> 'overvaagning'")
      .bind(now, athleteId),
  ]);
  const saved = await getPlanVersion(db, athleteId, version);
  return { ...saved, diff };
}
