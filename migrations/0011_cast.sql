-- Cast af en yogarutine til et TV: telefonen styrer, TV'et (en browser uden login) følger med via et hemmeligt
-- token eller en kort kode. Kun en tilføjelse. Rækkerne er midlertidige og ryddes op, når de er udløbet.
CREATE TABLE cast_sessions (
  token TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  athlete_id INTEGER NOT NULL REFERENCES athletes(id),
  title TEXT NOT NULL,
  routine_json TEXT NOT NULL,
  -- {"playing":bool,"elapsedMs":n,"tvSound":bool}; at = serverens tidspunkt for elapsedMs.
  state_json TEXT NOT NULL,
  state_at TEXT NOT NULL,
  tv_seen_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE UNIQUE INDEX cast_sessions_code ON cast_sessions (code);
CREATE INDEX cast_sessions_expires ON cast_sessions (expires_at);
