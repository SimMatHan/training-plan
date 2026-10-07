-- Fase 1: plan og logdata.
-- Fase 2–4 tilføjer tabeller/kolonner (plan_proposals, oauth, strava) — intet her skal omskrives.
--
-- Konventioner:
--   uuid               genereret på klienten (crypto.randomUUID)
--   updated_at         klientens ISO-tidsstempel (UTC, ms) — last-write-wins pr. post
--   deleted_at         tombstone; poster slettes aldrig fysisk, så sletninger synker
--   server_updated_at  sat af Worker ved hver skrivning; bruges som pull-cursor
--   datoer             'YYYY-MM-DD'; tidsstempler 'YYYY-MM-DDTHH:MM:SS.sssZ'

CREATE TABLE plan_versions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  version          INTEGER NOT NULL UNIQUE,
  created_at       TEXT    NOT NULL,
  source           TEXT    NOT NULL CHECK (source IN ('seed', 'manual', 'claude')),
  note             TEXT,
  plan_json        TEXT    NOT NULL,
  is_active        INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  -- Versionen den nye version er afledt af (tilbagerulning, fase 3-forslag).
  based_on_version INTEGER
);
-- Højst én aktiv version.
CREATE UNIQUE INDEX plan_versions_single_active ON plan_versions (is_active) WHERE is_active = 1;

CREATE TABLE workouts (
  uuid               TEXT PRIMARY KEY,
  planned_session_id TEXT,              -- session-id fra planen, fx 'styrke-a', 't1'
  plan_version       INTEGER,
  week_no            INTEGER,
  date               TEXT NOT NULL,
  started_at         TEXT,
  finished_at        TEXT,
  type               TEXT NOT NULL CHECK (type IN ('styrke', 'løb', 'cardio', 'mobilitet')),
  rpe                REAL CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  note               TEXT,
  groin_during       INTEGER CHECK (groin_during IS NULL OR groin_during BETWEEN 0 AND 10),
  source             TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'strava')),
  external_id        TEXT,
  distance_km        REAL,
  duration_sec       INTEGER,
  avg_hr             INTEGER,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT,
  server_updated_at  TEXT NOT NULL
);
CREATE INDEX workouts_date ON workouts (date);
CREATE INDEX workouts_week_session ON workouts (week_no, planned_session_id);
CREATE INDEX workouts_server_updated ON workouts (server_updated_at);
-- Fase 4: samme Strava-aktivitet må kun importeres én gang.
CREATE UNIQUE INDEX workouts_external ON workouts (source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE set_logs (
  uuid              TEXT PRIMARY KEY,
  workout_uuid      TEXT NOT NULL,
  exercise_id       TEXT NOT NULL,
  set_no            INTEGER NOT NULL,
  side              TEXT CHECK (side IS NULL OR side IN ('H', 'V')),
  weight_kg         REAL,
  reps              INTEGER,
  seconds           INTEGER,
  rpe               REAL CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  done              INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  server_updated_at TEXT NOT NULL
);
CREATE INDEX set_logs_workout ON set_logs (workout_uuid);
CREATE INDEX set_logs_exercise ON set_logs (exercise_id);
CREATE INDEX set_logs_server_updated ON set_logs (server_updated_at);

CREATE TABLE exercise_notes (
  uuid              TEXT PRIMARY KEY,
  workout_uuid      TEXT NOT NULL,
  exercise_id       TEXT NOT NULL,
  note              TEXT,
  rpe               REAL CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  server_updated_at TEXT NOT NULL
);
CREATE INDEX exercise_notes_workout ON exercise_notes (workout_uuid);
CREATE INDEX exercise_notes_exercise ON exercise_notes (exercise_id);
CREATE INDEX exercise_notes_server_updated ON exercise_notes (server_updated_at);

CREATE TABLE groin_checks (
  uuid              TEXT PRIMARY KEY,
  date              TEXT NOT NULL,
  morning_score     INTEGER NOT NULL CHECK (morning_score BETWEEN 0 AND 10),
  workout_uuid      TEXT,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  server_updated_at TEXT NOT NULL
);
CREATE INDEX groin_checks_date ON groin_checks (date);
CREATE INDEX groin_checks_server_updated ON groin_checks (server_updated_at);

CREATE TABLE mobility_measurements (
  uuid                  TEXT PRIMARY KEY,
  date                  TEXT NOT NULL,
  knee_to_wall_right_cm REAL,
  knee_to_wall_left_cm  REAL,
  note                  TEXT,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT,
  server_updated_at     TEXT NOT NULL
);
CREATE INDEX mobility_measurements_date ON mobility_measurements (date);
CREATE INDEX mobility_measurements_server_updated ON mobility_measurements (server_updated_at);

CREATE TABLE mobility_checks (
  uuid              TEXT PRIMARY KEY,
  workout_uuid      TEXT NOT NULL,
  item_id           TEXT NOT NULL,
  done              INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  server_updated_at TEXT NOT NULL
);
CREATE INDEX mobility_checks_workout ON mobility_checks (workout_uuid);
CREATE INDEX mobility_checks_server_updated ON mobility_checks (server_updated_at);
