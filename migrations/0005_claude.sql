-- Fase 3: Claude-connector (MCP). Kun tilføjelser — med én undtagelse, se workouts nedenfor.

-- ─── workouts.source får værdien 'claude' ───────────────────────────────────
-- SQLite kan ikke ændre en CHECK-constraint, så tabellen bygges om med præcis de samme
-- kolonner, i samme rækkefølge, og alle rækker kopieres. Intet omdøbes eller slettes set
-- udefra: tabellen hedder stadig workouts og har de samme kolonner og indekser.
CREATE TABLE workouts_ny (
  uuid               TEXT PRIMARY KEY,
  planned_session_id TEXT,
  plan_version       INTEGER,
  week_no            INTEGER,
  date               TEXT NOT NULL,
  started_at         TEXT,
  finished_at        TEXT,
  type               TEXT NOT NULL CHECK (type IN ('styrke', 'løb', 'cardio', 'mobilitet')),
  rpe                REAL CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  note               TEXT,
  groin_during       INTEGER CHECK (groin_during IS NULL OR groin_during BETWEEN 0 AND 10),
  source             TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'strava', 'claude')),
  external_id        TEXT,
  distance_km        REAL,
  duration_sec       INTEGER,
  avg_hr             INTEGER,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT,
  server_updated_at  TEXT NOT NULL,
  activity           TEXT,
  skipped_at         TEXT,
  skip_reason        TEXT
);
INSERT INTO workouts_ny (
  uuid, planned_session_id, plan_version, week_no, date, started_at, finished_at, type, rpe, note, groin_during,
  source, external_id, distance_km, duration_sec, avg_hr, updated_at, deleted_at, server_updated_at, activity, skipped_at, skip_reason
)
SELECT
  uuid, planned_session_id, plan_version, week_no, date, started_at, finished_at, type, rpe, note, groin_during,
  source, external_id, distance_km, duration_sec, avg_hr, updated_at, deleted_at, server_updated_at, activity, skipped_at, skip_reason
FROM workouts;
DROP TABLE workouts;
ALTER TABLE workouts_ny RENAME TO workouts;
CREATE INDEX workouts_date ON workouts (date);
CREATE INDEX workouts_week_session ON workouts (week_no, planned_session_id);
CREATE INDEX workouts_server_updated ON workouts (server_updated_at);
CREATE UNIQUE INDEX workouts_external ON workouts (source, external_id) WHERE external_id IS NOT NULL;

-- ─── Claudes forslag til planen ─────────────────────────────────────────────
-- Et forslag er en JSON Patch (RFC 6902) mod planversionen base_version. Det bliver aldrig
-- aktivt af sig selv: godkendes det i appen, bliver det en ny række i plan_versions.
CREATE TABLE plan_proposals (
  uuid           TEXT PRIMARY KEY,
  created_at     TEXT    NOT NULL,
  base_version   INTEGER NOT NULL,
  summary        TEXT    NOT NULL,
  rationale      TEXT    NOT NULL,
  patch_json     TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'afventer' CHECK (status IN ('afventer', 'godkendt', 'afvist', 'forældet')),
  decided_at     TEXT,
  -- Planversionen forslaget blev til, når det er godkendt.
  result_version INTEGER
);
CREATE INDEX plan_proposals_status ON plan_proposals (status);

-- ─── Noter fra Claude ───────────────────────────────────────────────────────
-- Synkes som de andre logtabeller (uuid, updated_at, deleted_at, server_updated_at),
-- så de kan læses offline og lukkes på telefonen.
CREATE TABLE coach_notes (
  uuid              TEXT PRIMARY KEY,
  created_at        TEXT NOT NULL,
  week_no           INTEGER,   -- NULL = generel note
  session_id        TEXT,      -- planens session-id; kræver week_no
  text              TEXT NOT NULL,
  dismissed_at      TEXT,      -- lukket i appen
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  server_updated_at TEXT NOT NULL
);
CREATE INDEX coach_notes_week ON coach_notes (week_no);
CREATE INDEX coach_notes_server_updated ON coach_notes (server_updated_at);

-- ─── Revisionslog for MCP-kald ──────────────────────────────────────────────
-- Kun værktøj, tidspunkt og udfald. Aldrig input-indhold.
CREATE TABLE mcp_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT    NOT NULL,
  tool        TEXT    NOT NULL,
  ok          INTEGER NOT NULL CHECK (ok IN (0, 1)),
  error       TEXT,     -- fejlkategori: 'ugyldigt-input', 'ikke-fundet', 'konflikt', 'serverfejl'
  duration_ms INTEGER
);
CREATE INDEX mcp_audit_at ON mcp_audit (at);

-- ─── Kodeordsforsøg på /authorize (rate limit) ──────────────────────────────
CREATE TABLE auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT    NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1))
);
CREATE INDEX auth_attempts_at ON auth_attempts (at);
