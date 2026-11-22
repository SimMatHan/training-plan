-- Påmindelser som push-beskeder (Web Push) til appen på telefonen. Kun tilføjelser.

-- Én række pr. enhed, der har slået "Husk mobilitet" til. endpoint er push-tjenestens adresse for enheden.
CREATE TABLE push_subscriptions (
  endpoint     TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users (id),
  athlete_id   INTEGER NOT NULL REFERENCES athletes (id),
  created_at   TEXT NOT NULL,
  -- Dansk dato for seneste morgenpåmindelse, så den aldrig sendes to gange samme dag.
  last_sent_on TEXT
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

-- Serverens egne nøgler (fx VAPID-nøglen til push), laves første gang de skal bruges.
CREATE TABLE app_keys (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
