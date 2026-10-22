// Træninger læst fra D1, og løb logget af Claude. Kaldes af MCP-værktøjerne. Alt er pr. atlet.
import { z } from 'zod';
import { IsoDate } from '../../shared/plan.schema';
import type { PainScore, Workout, WorkoutType } from '../../shared/records.schema';
import { listMonitors } from './athletes';
import { weekForDate } from '../../shared/resolve';
import { assignToOccurrences, effectiveSessions, occurrenceKey } from '../../shared/schedule';
import { todayInCopenhagen } from './clock';
import { ConflictError, ValidationError } from './errors';
import { readTable } from './history';
import { getActivePlan, getScheduleOverrides } from './plan';
import { pushChanges } from './sync';

/** Ikke-slettede træninger, ældste først. */
export async function listWorkouts(
  db: D1Database,
  athleteId: number,
  filter: { from?: string; to?: string; type?: WorkoutType; weekNo?: number } = {},
): Promise<Workout[]> {
  // Faste betingelser med parametre; kun dem med en værdi kommer med.
  const conditions: [string, unknown][] = [
    ['date >= ?', filter.from],
    ['date <= ?', filter.to],
    ['type = ?', filter.type],
    ['week_no = ?', filter.weekNo],
  ];
  const used = conditions.filter(([, v]) => v !== undefined);
  const where = ['deleted_at IS NULL', ...used.map(([sql]) => sql)].join(' AND ');
  const rows = (await readTable(db, athleteId, 'workouts', where, ...used.map(([, v]) => v))) as Workout[];
  return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.started_at ?? '').localeCompare(b.started_at ?? ''));
}

export const RunInput = z.object({
  date: IsoDate,
  distanceKm: z.number().positive().max(100),
  durationSec: z.int().min(60).max(24 * 3600),
  avgHr: z.int().min(30).max(250).nullable().default(null),
  rpe: z.number().min(1).max(10).multipleOf(0.5).nullable().default(null),
  note: z.string().trim().max(1000).nullable().default(null),
  /** Smerte under løbet pr. monitor (fx venstre lyske), 0–10. */
  pain: z.array(z.object({ monitorId: z.int().min(1), score: z.int().min(0).max(10) })).max(20).default([]),
  /** Planens løbesession (fx "t1"), hvis løbet er en planlagt session. */
  sessionId: z.string().nullable().default(null),
});
export type RunInput = z.input<typeof RunInput>;

/**
 * Opretter et løb med source = 'claude'. Er sessionId sat, knyttes det til ugens planlagte
 * løbesession (der ikke må være logget i forvejen); ellers er det et løb uden for planen.
 * Står sessionen flere gange i ugen, bruges forekomsten på løbets ugedag (efter flytninger),
 * ellers den første, der ikke er logget. Gemmes via sync-servicen, så appen henter det ved næste sync.
 */
export async function logRun(db: D1Database, athleteId: number, raw: RunInput, now = new Date()): Promise<{ workout: Workout; pain: PainScore[] }> {
  const input = RunInput.parse(raw);
  if (input.date > todayInCopenhagen(now)) throw new ValidationError('Datoen ligger i fremtiden');
  const { meta, plan } = await getActivePlan(db, athleteId);
  const week = weekForDate(plan, input.date);

  let plannedDay: number | null = null;
  if (input.sessionId) {
    if (!week) throw new ValidationError(`${input.date} ligger uden for planen, så løbet kan ikke knyttes til en session`);
    const session = plan.sessions.find((s) => s.id === input.sessionId);
    if (!session || session.kind !== 'løb') throw new ValidationError(`"${input.sessionId}" er ikke en løbesession i planen`);
    const occurrences = effectiveSessions(week, await getScheduleOverrides(db, athleteId, week.weekNo)).filter((s) => s.sessionId === input.sessionId);
    if (!occurrences.length) throw new ValidationError(`${session.name} står ikke i uge ${week.weekNo}`);
    const logged = assignToOccurrences(
      week,
      await listWorkouts(db, athleteId, { weekNo: week.weekNo }),
      (w) => w.planned_session_id,
      (w) => w.planned_day,
    );
    const free = occurrences.filter((s) => !logged.has(occurrenceKey(s.sessionId, s.plannedDay)));
    if (!free.length) throw new ConflictError(`${session.name} i uge ${week.weekNo} er allerede logget`);
    const weekday = ((new Date(input.date + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;
    plannedDay = (free.find((s) => s.day === weekday) ?? free[0]).plannedDay;
  }

  const ts = now.toISOString();
  const record: Workout = {
    uuid: crypto.randomUUID(),
    planned_session_id: input.sessionId,
    planned_day: plannedDay,
    plan_version: meta.version,
    week_no: week?.weekNo ?? null,
    date: input.date,
    started_at: null,
    finished_at: ts,
    type: 'løb',
    rpe: input.rpe,
    note: input.note || null,
    source: 'claude',
    external_id: null,
    distance_km: input.distanceKm,
    duration_sec: input.durationSec,
    avg_hr: input.avgHr,
    activity: input.sessionId ? null : 'Løb',
    skipped_at: null,
    skip_reason: null,
    updated_at: ts,
    deleted_at: null,
  };
  const monitors = new Set((await listMonitors(db, athleteId)).filter((m) => m.active).map((m) => m.id));
  for (const p of input.pain) if (!monitors.has(p.monitorId)) throw new ValidationError(`Ukendt monitor: ${p.monitorId}. Brug hent_profil`);
  const pain: PainScore[] = input.pain.map((p) => ({
    uuid: crypto.randomUUID(),
    monitor_id: p.monitorId,
    workout_uuid: record.uuid,
    date: record.date,
    kind: 'under',
    score: p.score,
    updated_at: ts,
    deleted_at: null,
  }));
  await pushChanges(db, athleteId, { workouts: [record], pain_scores: pain }, ts);
  return { workout: record, pain };
}
