// Kuraterede valg til seed-scriptet: stabile id'er, øvelsestyper og hvordan
// tvetydige celler i arket fortolkes. Alt der står med AFKLARING er et
// forslag, der skal godkendes — se plan/AFKLARING.md.
import type { Dose, ExerciseKind } from '../shared/plan.schema';

export interface ExerciseDef {
  id: string;
  name: string;
  kind: ExerciseKind;
  perSide: boolean;
}

const ex = (id: string, name: string, kind: ExerciseKind, perSide = false): ExerciseDef => ({ id, name, kind, perSide });

/** Øvelseskatalog. id'erne er stabile og må aldrig ændres. */
export const EXERCISES: ExerciseDef[] = [
  // Ben, hofte, lyske
  ex('rdl', 'Rumænsk dødløft (RDL)', 'weight_reps'),
  ex('enbens-rdl', 'Enbens RDL', 'weight_reps', true),
  ex('bulgarian-split-squat', 'Bulgarian split squat', 'weight_reps', true),
  ex('step-down', 'Step-down', 'weight_reps', true),
  ex('hip-airplane', 'Hip airplane', 'bodyweight_reps', true),
  ex('pallof-press', 'Pallof press', 'weight_reps', true),
  ex('hofteflexor-march', 'Hofteflexor-march, elastik', 'bodyweight_reps', true),
  ex('adduktorklem', 'Adduktorklem', 'time'),
  ex('copenhagen-plank', 'Copenhagen plank, venstre side', 'time'),
  ex('nordic-hamstring-curl', 'Nordic hamstring curl', 'bodyweight_reps'),
  ex('glideskinne-leg-curl', 'Glideskinne leg curl', 'bodyweight_reps'),
  ex('hip-thrust', 'Hip thrust', 'weight_reps'),
  ex('enbens-hip-thrust', 'Enbens hip thrust', 'weight_reps', true),
  // Achilles
  ex('enbens-tahaev', 'Enbens tåhæv, stående', 'weight_reps', true),
  ex('siddende-tahaev', 'Siddende tåhæv (bøjet knæ)', 'weight_reps'),
  // Overkrop
  ex('rows', 'Kabelrows eller håndvægtsrows', 'weight_reps'),
  ex('t-bar-row', 'T-bar row', 'weight_reps'),
  ex('lat-pulldown', 'Lat pulldown', 'weight_reps'),
  ex('pull-up-elastik', 'Pull-up med elastik', 'bodyweight_reps'),
  ex('skulderpres', 'Skulderpres, håndvægt', 'weight_reps'),
  ex('baenkpres-eller-armstraekninger', 'Bænkpres eller armstrækninger', 'weight_reps'),
  ex('face-pull', 'Face pull', 'weight_reps'),
  ex('prone-y-t', 'Prone Y-T på skråbænk', 'weight_reps'),
  ex('biceps-curl', 'Biceps curl', 'weight_reps'),
  ex('triceps-pushdown', 'Triceps pushdown', 'weight_reps'),
  ex('hammer-curl', 'Hammer curl', 'weight_reps'),
  ex('overhead-triceps-extension', 'Overhead triceps extension', 'weight_reps'),
  // Core
  ex('sideplanke', 'Sideplanke', 'time', true),
];

/**
 * Navn i arket → exercise-id. To id'er = superset.
 * Scriptet fejler hvis arket indeholder et navn der ikke står her.
 */
export const NAME_TO_IDS: Record<string, string[]> = {
  'Enbens RDL': ['enbens-rdl'],
  'Hip airplane': ['hip-airplane'],
  'Bulgarian split squat, begrænset dybde': ['bulgarian-split-squat'],
  'Bulgarian split squat': ['bulgarian-split-squat'],
  'Adduktorklem → Copenhagen kort vægtarm': ['adduktorklem'], // specialbehandles, se ADDUCTOR_REHAB
  'Hofteflexor-march, elastik': ['hofteflexor-march'],
  'Enbens tåhæv, stående — HØJRE FØRST': ['enbens-tahaev'],
  'Kabelrows eller håndvægtsrows': ['rows'],
  'Lat pulldown': ['lat-pulldown'],
  'Lat pulldown eller pull-up': ['lat-pulldown'], // AFKLARING #6
  'Skulderpres, håndvægt': ['skulderpres'],
  'Nordic hamstring curl': ['nordic-hamstring-curl'],
  Sideplanke: ['sideplanke'],
  'Biceps curl + triceps pushdown (superset)': ['biceps-curl', 'triceps-pushdown'],
  'Siddende tåhæv (bøjet knæ)': ['siddende-tahaev'],
  'Rumænsk dødløft (RDL)': ['rdl'],
  'Copenhagen plank — VENSTRE side': ['copenhagen-plank'],
  'Step-down': ['step-down'],
  'Glideskinne leg curl': ['glideskinne-leg-curl'],
  'Pallof press': ['pallof-press'],
  'Hip thrust': ['hip-thrust'],
  'Face pull': ['face-pull'],
  'T-bar row': ['t-bar-row'],
  'Pull-up med elastik': ['pull-up-elastik'],
  'Enbens hip thrust': ['enbens-hip-thrust'],
  'Bænkpres eller armstrækninger': ['baenkpres-eller-armstraekninger'],
  'Prone Y-T på skråbænk': ['prone-y-t'],
  'Hammer curl + overhead triceps extension': ['hammer-curl', 'overhead-triceps-extension'],
};

/** Styrkefaner i arket → session. */
export const STRENGTH_SHEETS = [
  { sheet: 'Rehab A', id: 'rehab-a', name: 'Rehab A', colorKey: 'A', weekday: 1 },
  { sheet: 'Rehab B', id: 'rehab-b', name: 'Rehab B', colorKey: 'B', weekday: 4 },
  { sheet: 'Styrke A', id: 'styrke-a', name: 'Styrke A', colorKey: 'A', weekday: 1 },
  { sheet: 'Styrke B', id: 'styrke-b', name: 'Styrke B', colorKey: 'B', weekday: 4 },
] as const;

/** Ugeplanens tekst → session-id, for styrke. */
export const STRENGTH_LABELS: Record<string, string> = {
  'Rehab A': 'rehab-a',
  'Rehab B': 'rehab-b',
  'Styrke A': 'styrke-a',
  'Styrke A (let)': 'styrke-a',
  'Styrke B': 'styrke-b',
  'Styrke B (let)': 'styrke-b',
};

/** Celler i ugeplanen der ikke er en session. */
export const REST_LABELS = new Set(['Hvile', 'Hvile / mobilitet', 'Mobilitet']);

/** Løbsugens beskrivende celler (uge 14) → egne løbesessioner. */
export const CUSTOM_RUNS: Record<string, { id: string; name: string; mainSet: string; workoutType: string; km?: [number, number] }> = {
  '5 km roligt + 4×20 sek strides': {
    id: 'rolig-5km-strides',
    name: '5 km roligt + strides',
    mainSet: '5 km roligt + 4×20 sek strides',
    workoutType: 'Roligt',
    km: [5, 5],
  },
  '3 km meget roligt + 3×20 sek strides': {
    id: 'rolig-3km-strides',
    name: '3 km meget roligt + strides',
    mainSet: '3 km meget roligt + 3×20 sek strides',
    workoutType: 'Meget roligt',
    km: [3, 3],
  },
  '5–6 km meget roligt': {
    id: 'rolig-5-6km',
    name: '5–6 km meget roligt',
    mainSet: '5–6 km meget roligt',
    workoutType: 'Meget roligt',
    km: [5, 6],
  },
};

/** Ugeplanens "LØB: 5 km – sub 20" peger på koden LØB i fanen Løbeworkouts. */
export const RACE_LABEL_PREFIX = 'LØB:';

/** Stabile id'er for mobilitetsblokkens punkter, i arkets rækkefølge. */
export const MOBILITY_ITEM_IDS = [
  'knae-til-vaeg-hojre',
  'knae-til-vaeg-venstre',
  'tahaev-trin-strakt',
  'soleus-straek',
  'psoas-release',
  'hip-cars',
  'hofteskift-90-90',
  'glute-bridge',
];

// ─── Fortolkning af tvetydigheder (AFKLARING) ───────────────────────────────

/**
 * AFKLARING #1 — RPE: progressionstabellens RPE erstatter øvelsens RPE i den
 * pågældende uge. Øvelser uden RPE (tempo, fx "3 sek hver vej") beholder tempoet.
 * Alternativer: 'ceiling' (laveste af de to), 'row' (øvelsens RPE altid).
 */
export const RPE_RULE: 'progression' | 'ceiling' | 'row' = 'progression';

/**
 * AFKLARING #2 — sæt: antal sæt = min(øvelsens sæt, progressionens sæt).
 * Øvelser der står til 2 sæt (fx face pull) bliver på 2.
 * "2–3 sæt" (uge 12) = 2 sæt + 1 valgfrit.
 */
export const SETS_RULE = 'min' as const;

/** AFKLARING #4 — unilaterale øvelser: højre først, skiftevis H1, V1, H2, V2 … */
export const SIDE_DEFAULTS: Pick<Dose, 'sideOrder' | 'sidePattern'> = { sideOrder: ['H', 'V'], sidePattern: 'alternate' };

/**
 * Rehab A, plads 4: adduktorklem → Copenhagen kort vægtarm, ugevis fra
 * progressionstabellen. Doseringen står eksplicit (3 sæt) og følger derfor
 * ikke progressionens sætantal. AFKLARING #3.
 */
export const ADDUCTOR_REHAB: Record<number, { exerciseId: string; label: string; sets: number; seconds: [number, number]; note?: string; alternative?: boolean }> = {
  1: { exerciseId: 'adduktorklem', label: 'Adduktorklem', sets: 3, seconds: [20, 20], note: 'Halv kraft.' },
  2: { exerciseId: 'adduktorklem', label: 'Adduktorklem', sets: 3, seconds: [30, 30], note: 'Fuld kraft hvis smertefrit.' },
  3: { exerciseId: 'copenhagen-plank', label: 'Copenhagen kort vægtarm', sets: 3, seconds: [10, 15], note: 'Knæet på bænken.', alternative: true },
  4: { exerciseId: 'copenhagen-plank', label: 'Copenhagen kort vægtarm', sets: 3, seconds: [20, 20], note: 'Knæet på bænken.', alternative: true },
};
/** Alternativ i uge 3–4: "Copenhagen med knæet på bænken først når klemmet er helt smertefrit." */
export const ADDUCTOR_FALLBACK = {
  exerciseId: 'adduktorklem',
  label: 'Adduktorklem',
  condition: 'Hvis klemmet ikke er helt smertefrit',
  sets: 3,
  seconds: [30, 30] as [number, number],
};

/**
 * Copenhagen plank i Styrke A/B: noten "Uge 5–8: knæstøttet 3 × 30 sek.
 * Uge 9–14: fuldt strakt ben 3 × 15–20 sek." Styrke B: "2 sæt, samme som Styrke A".
 * Sætantal følger AFKLARING #2. Samme exercise-id hele vejen (AFKLARING #5).
 */
export const COPENHAGEN_STRENGTH = [
  { weeks: { from: 5, to: 8 }, seconds: [30, 30] as [number, number], tempo: 'Knæstøttet (kort vægtarm)' },
  { weeks: { from: 9, to: 14 }, seconds: [15, 20] as [number, number], tempo: 'Fuldt strakt ben' },
];
