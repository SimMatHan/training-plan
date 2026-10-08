-- Fase 5: login (passkeys) og flere atleter. Al eksisterende data tilhører atleten "simon".
--
-- Rækkefølge (README, "Fase 5"):
--   1. nye tabeller
--   2. atlet simon og bruger Simon (admin) med adgang som ejer
--   3. athlete_id på alle eksisterende rækker
--   4. lyske og knee-to-wall flyttes til de generelle tabeller (pain_scores, mobility_tests)
--   5. kontrol af rækketal: en afvigelse får migrationen til at fejle (CHECK ok = 1)
-- De gamle kolonner (workouts.groin_during, groin_checks, knee_to_wall_*) fjernes IKKE her,
-- men i migrations-pending/0007_oprydning.sql, når alt er bekræftet.
--
-- athlete_id tilføjes som NOT NULL DEFAULT 0. 0 er "ingen atlet": alle forespørgsler filtrerer på
-- athlete_id = ?, så en række der mod forventning mangler atlet, er usynlig for alle i stedet for
-- at lække. plan_versions og calendar_settings bygges om, fordi deres nøgler skal være pr. atlet.

-- ─── 1. Nye tabeller ────────────────────────────────────────────────────────

CREATE TABLE users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  is_admin     INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at   TEXT    NOT NULL,
  -- Sat når onboarding er gennemført (navn, tærskelpuls, deling).
  onboarded_at TEXT
);

CREATE TABLE passkeys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users (id),
  credential_id TEXT    NOT NULL UNIQUE,   -- base64url
  public_key    TEXT    NOT NULL,          -- base64url (COSE)
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,                      -- JSON-liste, fx ["internal","hybrid"]
  label         TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  last_used_at  TEXT
);
CREATE INDEX passkeys_user ON passkeys (user_id);

-- Session-id'et står kun i cookien; her gemmes SHA-256 af det.
CREATE TABLE sessions (
  id_hash      TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users (id),
  created_at   TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  last_seen_at TEXT    NOT NULL,
  user_agent   TEXT
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Invitationslinks til første registrering og gendannelse. Tokenet gemmes hashet.
CREATE TABLE invites (
  token_hash TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  is_admin   INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  -- Sat ved gendannelse: passkey'en føjes til en eksisterende bruger.
  user_id    INTEGER REFERENCES users (id),
  created_by INTEGER REFERENCES users (id),
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  used_at    TEXT,
  used_by    INTEGER REFERENCES users (id)
);

-- WebAuthn-udfordringer mellem "options" og "verify" (få minutters levetid).
CREATE TABLE webauthn_challenges (
  id          TEXT    PRIMARY KEY,
  challenge   TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('login', 'invite', 'passkey')),
  user_id     INTEGER,
  invite_hash TEXT,
  expires_at  TEXT    NOT NULL
);

CREATE TABLE athletes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT    NOT NULL UNIQUE CHECK (slug GLOB '[a-z]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  name           TEXT    NOT NULL,
  threshold_hr   INTEGER CHECK (threshold_hr IS NULL OR threshold_hr BETWEEN 80 AND 230),
  created_at     TEXT    NOT NULL,
  -- SHA-256 af kalenderfeedets token (/cal/<slug>/<token>.ics). NULL = intet feed.
  cal_token_hash TEXT
);

CREATE TABLE athlete_access (
  user_id    INTEGER NOT NULL REFERENCES users (id),
  athlete_id INTEGER NOT NULL REFERENCES athletes (id),
  role       TEXT    NOT NULL CHECK (role IN ('ejer', 'traener')),
  granted_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, athlete_id)
);
CREATE INDEX athlete_access_athlete ON athlete_access (athlete_id);

-- Det der overvåges for smerte, fx "Venstre lyske". Trafiklyset gælder pr. monitor.
CREATE TABLE monitors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id INTEGER NOT NULL REFERENCES athletes (id),
  label      TEXT    NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX monitors_athlete ON monitors (athlete_id);

-- Smertescore 0–10: under en træning, eller morgenen efter. Synkes som logtabellerne.
CREATE TABLE pain_scores (
  uuid              TEXT    PRIMARY KEY,
  athlete_id        INTEGER NOT NULL,
  monitor_id        INTEGER NOT NULL,
  workout_uuid      TEXT,
  date              TEXT    NOT NULL,
  kind              TEXT    NOT NULL CHECK (kind IN ('under', 'morgen')),
  score             INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10),
  updated_at        TEXT    NOT NULL,
  deleted_at        TEXT,
  server_updated_at TEXT    NOT NULL
);
CREATE INDEX pain_scores_athlete_sync ON pain_scores (athlete_id, server_updated_at);
CREATE INDEX pain_scores_workout ON pain_scores (workout_uuid);

-- Mobilitetstests, fx knee-to-wall i cm pr. side. Påmindelsen gælder pr. test.
CREATE TABLE mobility_tests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id   INTEGER NOT NULL REFERENCES athletes (id),
  name         TEXT    NOT NULL,
  unit         TEXT    NOT NULL,
  per_side     INTEGER NOT NULL DEFAULT 1 CHECK (per_side IN (0, 1)),
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  instructions TEXT
);
CREATE INDEX mobility_tests_athlete ON mobility_tests (athlete_id);

-- ─── 2. Simon ───────────────────────────────────────────────────────────────

INSERT INTO athletes (slug, name, created_at) VALUES ('simon', 'Simon', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO users (name, is_admin, created_at, onboarded_at)
VALUES ('Simon', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO athlete_access (user_id, athlete_id, role, granted_at)
SELECT (SELECT id FROM users WHERE name = 'Simon'), (SELECT id FROM athletes WHERE slug = 'simon'), 'ejer', strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO monitors (athlete_id, label, active, sort) SELECT id, 'Venstre lyske', 1, 0 FROM athletes WHERE slug = 'simon';
-- Instruktionen hentes fra den aktive plan, hvis der er en.
INSERT INTO mobility_tests (athlete_id, name, unit, per_side, active, instructions)
SELECT id, 'Knee-to-wall', 'cm', 1, 1,
  (SELECT json_extract(plan_json, '$.mobility.measurement.instructions') FROM plan_versions WHERE is_active = 1)
FROM athletes WHERE slug = 'simon';

-- ─── 3. athlete_id på eksisterende tabeller ─────────────────────────────────

-- plan_versions: version er unik pr. atlet, og én aktiv version pr. atlet. Bygges om.
CREATE TABLE plan_versions_ny (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id       INTEGER NOT NULL REFERENCES athletes (id),
  version          INTEGER NOT NULL,
  created_at       TEXT    NOT NULL,
  source           TEXT    NOT NULL CHECK (source IN ('seed', 'manual', 'claude')),
  note             TEXT,
  plan_json        TEXT    NOT NULL,
  is_active        INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  based_on_version INTEGER,
  activated_at     TEXT,
  UNIQUE (athlete_id, version)
);
INSERT INTO plan_versions_ny (id, athlete_id, version, created_at, source, note, plan_json, is_active, based_on_version, activated_at)
SELECT id, (SELECT id FROM athletes WHERE slug = 'simon'), version, created_at, source, note, plan_json, is_active, based_on_version, activated_at
FROM plan_versions;

CREATE TABLE _fase5_kontrol (navn TEXT NOT NULL, ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _fase5_kontrol SELECT 'plan_versions kopieret', (SELECT COUNT(*) FROM plan_versions) = (SELECT COUNT(*) FROM plan_versions_ny);

DROP TABLE plan_versions;
ALTER TABLE plan_versions_ny RENAME TO plan_versions;
CREATE UNIQUE INDEX plan_versions_single_active ON plan_versions (athlete_id) WHERE is_active = 1;

-- calendar_settings: nøglen bliver (atlet, sessionstype). Bygges om.
CREATE TABLE calendar_settings_ny (
  athlete_id   INTEGER NOT NULL REFERENCES athletes (id),
  session_type TEXT    NOT NULL CHECK (session_type IN ('styrke', 'løb', 'cardio', 'mobilitet')),
  all_day      INTEGER NOT NULL DEFAULT 1 CHECK (all_day IN (0, 1)),
  start_time   TEXT CHECK (start_time IS NULL OR start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  duration_min INTEGER CHECK (duration_min IS NULL OR duration_min BETWEEN 5 AND 600),
  updated_at   TEXT    NOT NULL,
  PRIMARY KEY (athlete_id, session_type)
);
INSERT INTO calendar_settings_ny (athlete_id, session_type, all_day, start_time, duration_min, updated_at)
SELECT (SELECT id FROM athletes WHERE slug = 'simon'), session_type, all_day, start_time, duration_min, updated_at FROM calendar_settings;
INSERT INTO _fase5_kontrol SELECT 'calendar_settings kopieret', (SELECT COUNT(*) FROM calendar_settings) = (SELECT COUNT(*) FROM calendar_settings_ny);
DROP TABLE calendar_settings;
ALTER TABLE calendar_settings_ny RENAME TO calendar_settings;

-- De øvrige tabeller får en kolonne. Børn af workouts (sæt, øvelsesnoter, mobilitetstjek) får
-- den også, så sync og historik altid kan filtrere direkte på athlete_id.
ALTER TABLE workouts              ADD COLUMN athlete_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE set_logs              ADD COLUMN athlete_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exercise_notes        ADD COLUMN athlete_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mobility_checks       ADD COLUMN athlete_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mobility_measurements ADD COLUMN athlete_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE schedule_overrides    ADD COLUMN athlete_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coach_notes           ADD COLUMN athlete_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plan_proposals        ADD COLUMN athlete_id INTEGER NOT NULL DEFAULT 0;

UPDATE workouts              SET athlete_id = (SELECT id FROM athletes WHERE slug = 'simon');
UPDATE set_logs              SET athlete_id = (SELECT id FROM athletes WHERE slug = 'simon');
UPDATE exercise_notes        SET athlete_id = (SELECT id FROM athletes WHERE slug = 'simon');
UPDATE mobility_checks       SET athlete_id = (SELECT id FROM athletes WHERE slug = 'simon');
UPDATE mobility_measurements SET athlete_id = (SELECT id FROM athletes WHERE slug = 'simon');
UPDATE schedule_overrides    SET athlete_id = (SELECT id FROM athletes WHERE slug = 'simon');
UPDATE coach_notes           SET athlete_id = (SELECT id FROM athletes WHERE slug = 'simon');
UPDATE plan_proposals        SET athlete_id = (SELECT id FROM athletes WHERE slug = 'simon');

-- Forslag: ud over JSON Patch (fase 3) også en ny komplet plan og ændringer af overvågningen.
-- base_version = 0 betyder, at der ikke var en aktiv plan.
ALTER TABLE plan_proposals ADD COLUMN kind TEXT NOT NULL DEFAULT 'patch' CHECK (kind IN ('patch', 'ny-plan', 'overvaagning'));
ALTER TABLE plan_proposals ADD COLUMN payload_json TEXT;

-- Revisionsloggen: hvem kaldte, og for hvilken atlet.
ALTER TABLE mcp_audit ADD COLUMN user_id INTEGER;
ALTER TABLE mcp_audit ADD COLUMN athlete_id INTEGER;
UPDATE mcp_audit SET user_id = (SELECT id FROM users WHERE name = 'Simon'), athlete_id = (SELECT id FROM athletes WHERE slug = 'simon');

-- Rate limit for login og invitationer: pr. IP.
ALTER TABLE auth_attempts ADD COLUMN ip TEXT;
ALTER TABLE auth_attempts ADD COLUMN kind TEXT;
CREATE INDEX auth_attempts_ip ON auth_attempts (ip, at);

-- Indekser til sync og opslag pr. atlet.
CREATE INDEX workouts_athlete_sync ON workouts (athlete_id, server_updated_at);
CREATE INDEX workouts_athlete_week ON workouts (athlete_id, week_no);
CREATE INDEX set_logs_athlete_sync ON set_logs (athlete_id, server_updated_at);
CREATE INDEX exercise_notes_athlete_sync ON exercise_notes (athlete_id, server_updated_at);
CREATE INDEX mobility_checks_athlete_sync ON mobility_checks (athlete_id, server_updated_at);
CREATE INDEX mobility_measurements_athlete_sync ON mobility_measurements (athlete_id, server_updated_at);
CREATE INDEX schedule_overrides_athlete_sync ON schedule_overrides (athlete_id, server_updated_at);
CREATE INDEX coach_notes_athlete_sync ON coach_notes (athlete_id, server_updated_at);
CREATE INDEX plan_proposals_athlete ON plan_proposals (athlete_id, status);
CREATE INDEX mcp_audit_athlete ON mcp_audit (athlete_id, id);
-- Samme Strava-aktivitet kun én gang pr. atlet.
DROP INDEX workouts_external;
CREATE UNIQUE INDEX workouts_external ON workouts (athlete_id, source, external_id) WHERE external_id IS NOT NULL;

-- ─── 4. Lyske og knee-to-wall i de generelle tabeller ──────────────────────

-- Under-scoren: én række pr. træning med groin_during. uuid = træningens uuid (en anden tabel,
-- så ingen kollision), så appen kan finde den igen. Slettede træninger tager tombstonen med.
INSERT INTO pain_scores (uuid, athlete_id, monitor_id, workout_uuid, date, kind, score, updated_at, deleted_at, server_updated_at)
SELECT w.uuid, w.athlete_id, m.id, w.uuid, w.date, 'under', w.groin_during, w.updated_at, w.deleted_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workouts w
JOIN monitors m ON m.athlete_id = w.athlete_id AND m.label = 'Venstre lyske'
WHERE w.groin_during IS NOT NULL;

-- Morgenscoren: samme uuid som i groin_checks.
INSERT INTO pain_scores (uuid, athlete_id, monitor_id, workout_uuid, date, kind, score, updated_at, deleted_at, server_updated_at)
SELECT g.uuid, a.id, m.id, g.workout_uuid, g.date, 'morgen', g.morning_score, g.updated_at, g.deleted_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM groin_checks g
JOIN athletes a ON a.slug = 'simon'
JOIN monitors m ON m.athlete_id = a.id AND m.label = 'Venstre lyske';

-- Knee-to-wall: målingerne får test_id og værdier pr. side (value = tests uden sider).
ALTER TABLE mobility_measurements ADD COLUMN test_id INTEGER;
ALTER TABLE mobility_measurements ADD COLUMN value_right REAL;
ALTER TABLE mobility_measurements ADD COLUMN value_left REAL;
ALTER TABLE mobility_measurements ADD COLUMN value REAL;
UPDATE mobility_measurements
SET test_id = (SELECT t.id FROM mobility_tests t WHERE t.athlete_id = mobility_measurements.athlete_id AND t.name = 'Knee-to-wall'),
    value_right = knee_to_wall_right_cm,
    value_left = knee_to_wall_left_cm,
    server_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
CREATE INDEX mobility_measurements_test ON mobility_measurements (test_id, date);

-- ─── 5. Kontrol: fejler migrationen, hvis noget ikke passer ────────────────

INSERT INTO _fase5_kontrol SELECT 'én atlet simon', (SELECT COUNT(*) FROM athletes WHERE slug = 'simon') = 1;
INSERT INTO _fase5_kontrol SELECT 'Simon er admin og ejer', EXISTS (
  SELECT 1 FROM athlete_access x JOIN users u ON u.id = x.user_id JOIN athletes a ON a.id = x.athlete_id
  WHERE u.name = 'Simon' AND u.is_admin = 1 AND a.slug = 'simon' AND x.role = 'ejer');
INSERT INTO _fase5_kontrol SELECT 'workouts har atlet',              NOT EXISTS (SELECT 1 FROM workouts WHERE athlete_id = 0);
INSERT INTO _fase5_kontrol SELECT 'set_logs har atlet',              NOT EXISTS (SELECT 1 FROM set_logs WHERE athlete_id = 0);
INSERT INTO _fase5_kontrol SELECT 'exercise_notes har atlet',        NOT EXISTS (SELECT 1 FROM exercise_notes WHERE athlete_id = 0);
INSERT INTO _fase5_kontrol SELECT 'mobility_checks har atlet',       NOT EXISTS (SELECT 1 FROM mobility_checks WHERE athlete_id = 0);
INSERT INTO _fase5_kontrol SELECT 'mobility_measurements har atlet', NOT EXISTS (SELECT 1 FROM mobility_measurements WHERE athlete_id = 0);
INSERT INTO _fase5_kontrol SELECT 'schedule_overrides har atlet',    NOT EXISTS (SELECT 1 FROM schedule_overrides WHERE athlete_id = 0);
INSERT INTO _fase5_kontrol SELECT 'coach_notes har atlet',           NOT EXISTS (SELECT 1 FROM coach_notes WHERE athlete_id = 0);
INSERT INTO _fase5_kontrol SELECT 'plan_proposals har atlet',        NOT EXISTS (SELECT 1 FROM plan_proposals WHERE athlete_id = 0);
INSERT INTO _fase5_kontrol SELECT 'lyske under flyttet',
  (SELECT COUNT(*) FROM workouts WHERE groin_during IS NOT NULL) = (SELECT COUNT(*) FROM pain_scores WHERE kind = 'under');
INSERT INTO _fase5_kontrol SELECT 'lyske under uændret',
  NOT EXISTS (SELECT 1 FROM workouts w LEFT JOIN pain_scores p ON p.uuid = w.uuid AND p.kind = 'under'
              WHERE w.groin_during IS NOT NULL AND (p.score IS NOT w.groin_during OR p.deleted_at IS NOT w.deleted_at));
INSERT INTO _fase5_kontrol SELECT 'lyske morgen flyttet',
  (SELECT COUNT(*) FROM groin_checks) = (SELECT COUNT(*) FROM pain_scores WHERE kind = 'morgen');
INSERT INTO _fase5_kontrol SELECT 'knee-to-wall flyttet',
  NOT EXISTS (SELECT 1 FROM mobility_measurements
              WHERE test_id IS NULL OR value_right IS NOT knee_to_wall_right_cm OR value_left IS NOT knee_to_wall_left_cm);
DROP TABLE _fase5_kontrol;
