-- Hvilken af to øvelser der blev taget, når øvelsen hedder "X eller Y" (fx "Kabelrows"). Kun en tilføjelse.
-- Gemmes pr. træning og øvelse i exercise_notes. NULL = ikke valgt.
ALTER TABLE exercise_notes ADD COLUMN variant TEXT;
