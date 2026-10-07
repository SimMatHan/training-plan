-- Flytning af planlagte sessioner og andre aktiviteter (padel o.l.). Kun tilføjelser.

-- Hvilken sport en træning uden for planen er, fx 'Padel'. NULL for planens sessioner.
-- Fase 4 kan udfylde den fra Strava (fx 'Ride', 'Walk').
ALTER TABLE workouts ADD COLUMN activity TEXT;

-- En planlagt session flyttet til en anden dag i samme uge. Planen selv ændres ikke.
CREATE TABLE schedule_overrides (
  uuid              TEXT PRIMARY KEY,   -- deterministisk ud fra uge + session
  week_no           INTEGER NOT NULL,
  session_id        TEXT NOT NULL,
  day               INTEGER NOT NULL CHECK (day BETWEEN 1 AND 7),  -- 1 = mandag
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,               -- tombstone = tilbage til planens dag
  server_updated_at TEXT NOT NULL
);
CREATE INDEX schedule_overrides_week ON schedule_overrides (week_no);
CREATE INDEX schedule_overrides_server_updated ON schedule_overrides (server_updated_at);
