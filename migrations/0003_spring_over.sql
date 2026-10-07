-- Markér en planlagt session som sprunget over (bevidst), så det logges. Kun tilføjelser.

-- Tidspunkt for markeringen. NULL = ikke sprunget over.
ALTER TABLE workouts ADD COLUMN skipped_at TEXT;
-- Kort årsag, fx 'Lyske/smerte', 'Syg', 'Kalender'. Uddybning kan stå i note.
ALTER TABLE workouts ADD COLUMN skip_reason TEXT;
