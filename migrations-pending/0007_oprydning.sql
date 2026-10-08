-- Fase 5, oprydning. Køres FØRST når fase 5 er bekræftet i drift (README, "Fase 5: udrulning" trin 7):
-- flyt filen til migrations/ og push. Workers Builds kører den så ved næste deploy.
--
-- Fjerner de gamle lyske- og knee-to-wall-felter, som 0006 har kopieret til pain_scores og
-- mobility_measurements.value_*. Koden læser og skriver dem ikke længere.

ALTER TABLE workouts DROP COLUMN groin_during;
DROP TABLE groin_checks;
ALTER TABLE mobility_measurements DROP COLUMN knee_to_wall_right_cm;
ALTER TABLE mobility_measurements DROP COLUMN knee_to_wall_left_cm;
