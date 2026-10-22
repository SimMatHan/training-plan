-- Plan-format: mobilitetsblokken morgen og aften (mobility.schedule i planen).
-- Kun en ny tabel. mobility_checks (afkrydsning knyttet til en træning) bruges stadig af planer uden runder.

-- Et punkt i blokken krydset af i en runde på en dato. Uuid'en er deterministisk (dato + runde + punkt).
CREATE TABLE mobility_round_checks (
  uuid              TEXT    PRIMARY KEY,
  athlete_id        INTEGER NOT NULL,
  date              TEXT    NOT NULL,
  round             TEXT    NOT NULL CHECK (round IN ('morgen', 'aften')),
  item_id           TEXT    NOT NULL,
  done              INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT    NOT NULL,
  deleted_at        TEXT,
  server_updated_at TEXT    NOT NULL
);
CREATE INDEX mobility_round_checks_athlete_sync ON mobility_round_checks (athlete_id, server_updated_at);
CREATE INDEX mobility_round_checks_athlete_date ON mobility_round_checks (athlete_id, date);
