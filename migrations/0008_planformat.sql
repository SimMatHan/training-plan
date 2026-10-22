-- Plan-format: samme session flere gange i en uge.
-- Kun tilføjelser. Eksisterende rækker får NULL og bliver ikke rørt: en træning eller flytning uden planens dag
-- hører til sessionen, når den kun står én gang i ugen (shared/schedule.ts), præcis som før.

-- Planens dag (1–7) for den forekomst af sessionen, træningen hører til.
ALTER TABLE workouts ADD COLUMN planned_day INTEGER;

-- Planens dag for den forekomst, der er flyttet.
ALTER TABLE schedule_overrides ADD COLUMN planned_day INTEGER;
