# Afklaring: tvetydigheder i traeningsplan.xlsx

Seed-scriptet bruger i dag forslaget under hvert punkt. Valgene står i
`plan/seed-config.ts` og skal godkendes, før planversion 1 er endelig.
Se resultatet uge for uge i `plan/plan.v1.oversigt.md`.

## 1. RPE: øvelsens eller progressionstabellens?

Øvelsesrækkerne har egen RPE (fx RDL RPE 7, face pull RPE 6). Progressionstabellen
har en RPE pr. uge (fx uge 5: RPE 6, uge 9–10: RPE 7–8).

**Forslag:** progressionens RPE erstatter øvelsens RPE den uge, for alle øvelser
der har en RPE. Øvelser med tempo i stedet (Nordic "Langsom sænkning 3–4 sek",
hip airplane "3 sek hver vej", sideplanke "Kontrol") får ingen RPE.

Alternativer: (b) laveste af de to, (c) altid øvelsens RPE, hvor progressionen kun styrer sæt.

## 2. Sæt

**Forslag:** sæt = min(øvelsens sæt, progressionens sæt).
- Øvelser der står til 2 sæt (hip airplane, face pull, prone Y-T, Copenhagen i Styrke B) bliver på 2.
- Tåhæv følger med: uge 1 bliver 2 × 12 H / 2 × 10 V.
- Uge 12 "2–3 sæt" = 2 sæt plus 1 valgfrit sæt, vist som en dæmpet ekstra række.

## 3. Adduktorklem → Copenhagen (Rehab A, øvelse 4)

**Forslag:** den eksplicitte dosering i progressionstabellen gælder, også i uge 1, hvor
de øvrige øvelser kører 2 sæt:
- uge 1: adduktorklem 3 × 20 sek, halv kraft
- uge 2: adduktorklem 3 × 30 sek, fuld kraft hvis smertefrit
- uge 3: Copenhagen kort vægtarm 3 × 10–15 sek
- uge 4: Copenhagen kort vægtarm 3 × 20 sek

I uge 3–4 er adduktorklem 3 × 30 sek lagt ind som alternativ, "hvis klemmet ikke er
helt smertefrit". For uge 3 står det i arket. For uge 4 er det udledt af noten
"Copenhagen med knæet på bænken først når klemmet er helt smertefrit".

## 4. Unilaterale øvelser: rækkefølge

Kun tåhæv har "HØJRE FØRST". Ingen af øvelserne siger, om siderne skiftes pr. sæt.

**Forslag:** højre først og skiftevis (H1, V1, H2, V2 …), med pausen efter hvert par.
Alternativ: blokvis (alle sæt højre, derefter venstre). Det kan sættes pr. øvelse.

## 5. Copenhagen plank: ét eller to exercise-id?

Knæstøttet (uge 3–8) og fuldt strakt ben (uge 9–14) er reelt to sværhedsgrader. Arket
siger dog, at Copenhagen "skal kunne måles over tid".

**Forslag:** ét id, `copenhagen-plank`, med varianten som tempo/note pr. uge. Historikken
er så samlet, men sekunderne falder naturligt ved skiftet i uge 9.

## 6. "Eller"-øvelser

"Kabelrows eller håndvægtsrows", "Lat pulldown eller pull-up" (Styrke B) og "Bænkpres
eller armstrækninger".

**Forslag:** ét id pr. række (`rows`, `lat-pulldown`, `baenkpres-eller-armstraekninger`).
Hvis du skifter udstyr fra gang til gang, kan "sidst"-tallene ikke sammenlignes. Alternativt
får hver variant sit eget id, og så vælger du variant i appen.

## 7. Rotationsøvelser uden dosering (uge 9–12)

T-bar row, pull-up med elastik, bænkpres/armstrækninger og hammer curl + overhead
triceps står uden sæt × reps.

**Forslag:** de arver grundøvelsens sæt × reps, RPE og pause (fx T-bar row 3 × 10, RPE efter #1, 90 sek).
Glideskinne leg curl og Pallof press arver pausen, men ingen intensitet, fordi
grundøvelsen (Nordic, hip airplane) havde et tempo-krav i stedet for RPE. Skal de have
progressionens RPE?

## 8. Porten efter uge 4

"Gentag uge 4" ved gult trafiklys rykker hele kalenderen, men løbet 31/12 ligger fast.

**Forslag:** fase 1 viser porten og trafiklysene for uge 3–4 i uge 4, men ændrer ikke
planen. Gentages uge 4, sker det som en ny planversion. Hver uge har sin egen startdato
i plan-skemaet, så en ny version kan gentage og forkorte uger uden at bryde noget.

## Beslutninger uden spørgsmål (til orientering)

- Uge 0 (21.–27. sep) ligger før planens start og er udeladt.
- "Hvile / mobilitet" er ikke en planlagt session. Mobilitetsblokken kan startes alene
  som sessionen `mobilitet` alle dage.
- Søndagens R-løb er markeret valgfrit. Arket kalder det "valgfri, søndag".
- Baseline-målingen 27/9 (højre 5 cm, venstre 7 cm) seedes. Eksempelrækken (29/9) springes over.
- `workouts.planned_session_id` er sessionens id (`styrke-a`, `t1` …). Sammen med `week_no`
  giver den status pr. uge.
- Tåhæv og andre øvelser, hvor vægt er valgfri, er `vægt × reps`, og tom vægt betyder kropsvægt.
