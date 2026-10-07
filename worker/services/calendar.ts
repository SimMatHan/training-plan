// Kalenderfeed og -indstillinger. Feedet genereres hver gang ud fra aktiv planversion
// og logs; intet caches i D1.
import { z } from 'zod';
import { CALENDAR_TYPES, defaultSetting, type CalendarSetting } from '../../shared/calendar';
import type { GroinCheck, ScheduleOverride, SetLog, Workout, WorkoutType } from '../../shared/records.schema';
import { renderFeed } from '../calendar/feed';
import { readTable } from './history';
import { getActivePlan } from './plan';

interface SettingRow {
  session_type: WorkoutType;
  all_day: number;
  start_time: string | null;
  duration_min: number | null;
  updated_at: string;
}

const toSetting = (r: SettingRow): CalendarSetting => ({ ...r, all_day: r.all_day === 1 });

/** Indstilling pr. sessionstype i kalenderen. Typer uden række er heldag. */
export async function getCalendarSettings(db: D1Database): Promise<CalendarSetting[]> {
  const { results } = await db.prepare('SELECT * FROM calendar_settings').all<SettingRow>();
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
  type: (typeof CALENDAR_TYPES)[number],
  input: CalendarSettingInput,
  now = new Date().toISOString(),
): Promise<CalendarSetting> {
  await db
    .prepare(
      'INSERT INTO calendar_settings (session_type, all_day, start_time, duration_min, updated_at) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT (session_type) DO UPDATE SET all_day = excluded.all_day, start_time = excluded.start_time, ' +
        'duration_min = excluded.duration_min, updated_at = excluded.updated_at',
    )
    .bind(type, input.all_day ? 1 : 0, input.start_time, input.duration_min, now)
    .run();
  return { session_type: type, ...input, updated_at: now };
}

/** Hele kalenderfeedet (.ics) for den aktive plan. `origin` bruges til dybe links ind i appen. */
export async function buildCalendarFeed(db: D1Database, opts: { origin: string; now?: Date }): Promise<string> {
  const { meta, plan } = await getActivePlan(db);
  const planned = 'WHERE planned_session_id IS NOT NULL';
  const [activation, workouts, sets, groinChecks, overrides, settings] = await Promise.all([
    db.prepare('SELECT activated_at FROM plan_versions WHERE version = ?').bind(meta.version).first<string | null>('activated_at'),
    // Tombstones med: de indgår i SEQUENCE, så sletninger og fortrudte flytninger opdaterer eventet.
    readTable(db, 'workouts', planned) as Promise<Workout[]>,
    readTable(db, 'set_logs', `WHERE workout_uuid IN (SELECT uuid FROM workouts ${planned})`) as Promise<SetLog[]>,
    readTable(db, 'groin_checks') as Promise<GroinCheck[]>,
    readTable(db, 'schedule_overrides') as Promise<ScheduleOverride[]>,
    getCalendarSettings(db),
  ]);
  return renderFeed({
    plan,
    planVersion: meta.version,
    planChangedAt: activation ?? meta.created_at,
    workouts,
    sets,
    groinChecks,
    overrides,
    settings,
    origin: opts.origin,
    now: (opts.now ?? new Date()).getTime(),
  });
}
