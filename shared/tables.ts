/**
 * Synkroniserede tabeller i fast rækkefølge. Uden zod, så frontenden kan importere
 * listen uden at få skema-biblioteket med i bundlen. Holdes i sync med SyncTables
 * (records.schema.ts tjekker det ved typecheck).
 */
export const SYNC_TABLES = [
  'workouts',
  'set_logs',
  'exercise_notes',
  'pain_scores',
  'mobility_measurements',
  'mobility_checks',
  'schedule_overrides',
  'coach_notes',
  'mobility_round_checks',
] as const;
