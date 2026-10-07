-- Fase 2: kalenderfeed. Kun tilføjelser.

-- Tidspunkt pr. sessionstype i kalenderen. Mangler en række, er typen heldag.
CREATE TABLE calendar_settings (
  session_type TEXT PRIMARY KEY CHECK (session_type IN ('styrke', 'løb', 'cardio', 'mobilitet')),
  all_day      INTEGER NOT NULL DEFAULT 1 CHECK (all_day IN (0, 1)),
  start_time   TEXT CHECK (start_time IS NULL OR start_time GLOB '[0-2][0-9]:[0-5][0-9]'),  -- 'HH:MM', lokal tid
  duration_min INTEGER CHECK (duration_min IS NULL OR duration_min BETWEEN 5 AND 600),
  updated_at   TEXT NOT NULL                                                          -- sat af Worker
);

-- Hvornår versionen sidst blev gjort aktiv. Feedets SEQUENCE afledes heraf, så en
-- tilbagerulning til en ældre version også tæller som en ændring. NULL = created_at.
ALTER TABLE plan_versions ADD COLUMN activated_at TEXT;
