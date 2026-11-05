-- Træningens egen opsætning ud over planen: øvelsernes rækkefølge og fjernede planlagte sæt. Kun en tilføjelse.
-- JSON, fx {"order":["s2","s1"],"removed":{"rdl":[3]}}. NULL = som planen.
ALTER TABLE workouts ADD COLUMN layout TEXT;
