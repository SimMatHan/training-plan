// Kalenderindstillinger: heldag eller starttidspunkt + varighed pr. sessionstype.
// Uden zod, så frontenden kan importere typerne og standardværdierne direkte.
import type { WorkoutType } from './records.schema';

export interface CalendarSetting {
  session_type: WorkoutType;
  all_day: boolean;
  /** 'HH:MM' i dansk tid. Null ved heldag. */
  start_time: string | null;
  duration_min: number | null;
  updated_at: string | null;
}

/** Sessionstyper i ugeplanen (mobilitetsblokken ligger ikke i kalenderen). */
export const CALENDAR_TYPES = ['styrke', 'løb', 'cardio'] as const satisfies readonly WorkoutType[];

export const CALENDAR_TYPE_LABELS: Record<(typeof CALENDAR_TYPES)[number], string> = {
  styrke: 'Styrke og rehab',
  løb: 'Løb',
  cardio: 'Crosstrainer',
};

/** Forslag når en type skiftes fra heldag til et tidspunkt. */
export const DEFAULT_TIMED: Record<(typeof CALENDAR_TYPES)[number], { start_time: string; duration_min: number }> = {
  styrke: { start_time: '07:00', duration_min: 60 },
  løb: { start_time: '07:00', duration_min: 60 },
  cardio: { start_time: '07:00', duration_min: 50 },
};

/** Standard er heldag. */
export const defaultSetting = (session_type: WorkoutType): CalendarSetting => ({
  session_type,
  all_day: true,
  start_time: null,
  duration_min: null,
  updated_at: null,
});

export interface CalendarInfo {
  /** Abonnements-URL (https). Null hvis CAL_TOKEN ikke er sat på Worker'en. */
  feedUrl: string | null;
  settings: CalendarSetting[];
}
