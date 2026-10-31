-- Et planlagt sæt kan fjernes i en træning ("Fjern sæt"). Det gemmes som en sætlog med skipped = 1,
-- så sættet ikke vises og ikke tæller med i fremdriften. Eksisterende rækker får 0.
ALTER TABLE set_logs ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0;
