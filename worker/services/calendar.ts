// Kalenderfeed og -indstillinger pr. atlet. Feedet genereres hver gang ud fra aktiv planversion
// og logs; intet caches i D1. Feedets token gemmes kun som SHA-256 (athletes.cal_token_hash).
import { z } from 'zod';
import { CALENDAR_TYPES, defaultSetting, type CalendarSetting } from '../../shared/calendar';
import type { PainScore, ScheduleOverride, SetLog, Workout, WorkoutType } from '../../shared/records.schema';
import { renderEmptyFeed, renderFeed } from '../calendar/feed';
import { randomToken, sha256Hex, timingSafeEqualHex } from '../crypto';
import { getAthleteBySlug, listMonitors } from './athletes';
import { readTable } from './history';
import { findActivePlan } from './plan';

interface SettingRow {
  session_type: WorkoutType;
  all_day: number;
  start_time: string | null;
  duration_min: number | null;
  updated_at: string;
}

const toSetting = (r: SettingRow): CalendarSetting => ({ ...r, all_day: r.all_day === 1 });

/** Indstilling pr. sessionstype i kalenderen. Typer uden række er heldag. */
export async function getCalendarSettings(db: D1Database, athleteId: number): Promise<CalendarSetting[]> {
  const { results } = await db
    .prepare('SELECT session_type, all_day, start_time, duration_min, updated_at FROM calendar_settings WHERE athlete_id = ?')
    .bind(athleteId)
    .all<SettingRow>();
  const stored = new Map(results.map((r) => [r.session_type, toSetting(r)]));
  return CALENDAR_TYPES.map((t) => stored.get(t) ?? defaultSetting(t));
}

export const CalendarType = z.enum(CALENDAR_TYPES);

export const CalendarSettingInput = z
  .object({
    all_day: z.boolean(),
    start_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Starttidspunkt skal være HH:MM')
      .nullable()
      .default(null),
    duration_min: z.int().min(5).max(600).nullable().default(null),
  })
  .refine((s) => s.all_day || (s.start_time && s.duration_min), 'Starttidspunkt og varighed skal udfyldes, når sessionen ikke er heldag');
export type CalendarSettingInput = z.infer<typeof CalendarSettingInput>;

/** Gemmer heldag eller tidspunkt + varighed for en sessionstype. */
export async function setCalendarSetting(
  db: D1Database,
  athleteId: number,
  type: (typeof CALENDAR_TYPES)[number],
  input: CalendarSettingInput,
  now = new Date().toISOString(),
): Promise<CalendarSetting> {
  await db
    .prepare(
      'INSERT INTO calendar_settings (athlete_id, session_type, all_day, start_time, duration_min, updated_at) VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT (athlete_id, session_type) DO UPDATE SET all_day = excluded.all_day, start_time = excluded.start_time, ' +
        'duration_min = excluded.duration_min, updated_at = excluded.updated_at',
    )
    .bind(athleteId, type, input.all_day ? 1 : 0, input.start_time, input.duration_min, now)
    .run();
  return { session_type: type, ...input, updated_at: now };
}

/** Hele kalenderfeedet (.ics) for atletens aktive plan. `origin` bruges til dybe links ind i appen. */
export async function buildCalendarFeed(db: D1Database, athleteId: number, opts: { origin: string; now?: Date }): Promise<string> {
  const active = await findActivePlan(db, athleteId);
  if (!active) return renderEmptyFeed();
  const { meta, plan } = active;
  const planned = 'planned_session_id IS NOT NULL';
  const [activation, workouts, sets, painScores, overrides, settings, monitors] = await Promise.all([
    db.prepare('SELECT activated_at FROM plan_versions WHERE athlete_id = ? AND version = ?').bind(athleteId, meta.version).first<string | null>('activated_at'),
    // Tombstones med: de indgår i SEQUENCE, så sletninger og fortrudte flytninger opdaterer eventet.
    readTable(db, athleteId, 'workouts', planned) as Promise<Workout[]>,
    readTable(db, athleteId, 'set_logs', `workout_uuid IN (SELECT uuid FROM workouts WHERE athlete_id = ? AND ${planned})`, athleteId) as Promise<SetLog[]>,
    readTable(db, athleteId, 'pain_scores') as Promise<PainScore[]>,
    readTable(db, athleteId, 'schedule_overrides') as Promise<ScheduleOverride[]>,
    getCalendarSettings(db, athleteId),
    listMonitors(db, athleteId),
  ]);
  return renderFeed({
    plan,
    planVersion: meta.version,
    planChangedAt: activation ?? meta.created_at,
    workouts,
    sets,
    painScores,
    monitors: monitors.filter((m) => m.active),
    overrides,
    settings,
    origin: opts.origin,
    now: (opts.now ?? new Date()).getTime(),
  });
}

/** Laver et nyt token til feedet. Det gamle holder straks op med at virke. Tokenet vises kun nu. */
export async function rotateCalendarToken(db: D1Database, athleteId: number): Promise<string> {
  const token = randomToken(32);
  await db.prepare('UPDATE athletes SET cal_token_hash = ? WHERE id = ?').bind(await sha256Hex(token), athleteId).run();
  return token;
}

export async function hasCalendarToken(db: D1Database, athleteId: number): Promise<boolean> {
  return !!(await db.prepare('SELECT cal_token_hash FROM athletes WHERE id = ?').bind(athleteId).first<string | null>('cal_token_hash'));
}

/** Atletens id, hvis tokenet passer til atletens feed; ellers null. */
export async function verifyCalendarToken(db: D1Database, slug: string, token: string): Promise<number | null> {
  const athlete = await getAthleteBySlug(db, slug);
  if (!athlete) return null;
  const stored = await db.prepare('SELECT cal_token_hash FROM athletes WHERE id = ?').bind(athlete.id).first<string | null>('cal_token_hash');
  if (!stored) return null;
  return timingSafeEqualHex(await sha256Hex(token), stored) ? athlete.id : null;
}
