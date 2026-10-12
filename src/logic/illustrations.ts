// Illustrationer af planens øvelser og mobilitetspunkter som tændstiksmænd. Hver øvelse er to
// stillinger (start og slut); figuren bevæger sig frem og tilbage mellem dem. Set fra siden,
// figuren vender mod højre. Gulvet er y = 150, lærredet 200 × 160.
import type { Angles, Joint, Point, Pose } from './figure';

/** Udstyr. Faste ting har koordinater; ting i hænderne følger et led. */
export type Prop =
  | { kind: 'barbell'; at?: Joint }
  | { kind: 'dumbbell'; hands?: 'begge' | 'naer' }
  | { kind: 'plate'; at: Joint }
  | { kind: 'bench'; x: number; y: number; w: number; h: number }
  | { kind: 'incline'; from: Point; to: Point }
  | { kind: 'wall'; x: number }
  | { kind: 'bar'; at: Point }
  | { kind: 'ball'; at: Joint; dx?: number; dy?: number; r: number; front?: boolean }
  | { kind: 'cable'; from: Point; to: Joint }
  | { kind: 'band'; a: Joint; b: Joint }
  | { kind: 'pad'; at: Joint };

export interface Illustration {
  from: Pose;
  to: Pose;
  props?: Prop[];
  /** Sekunder for en hel bevægelse frem og tilbage. */
  seconds?: number;
}

// Afslappet stående stilling; øvelserne ændrer kun det, de bruger.
const STAND: Angles = { torso: 180, uaN: 6, laN: 2, uaF: -6, laF: -2, thN: 3, shN: -2, thF: -3, shF: 2 };
const FOOT: Point = [100, 147];

const pose = (anchor: Joint, at: Point, angles: Partial<Angles>, base: Angles = STAND): Pose => ({ ...base, ...angles, anchor, at });
const standing = (angles: Partial<Angles>) => pose('ankleN', FOOT, angles);

// Liggende på ryggen med bøjede knæ (glute bridge, adduktorklem): skuldrene i gulvet.
const SUPINE: Angles = { torso: -96, head: 0, uaN: 100, laN: 95, uaF: 100, laF: 95, thN: 125, shN: 25, thF: 125, shF: 25 };

const curl: Illustration = {
  from: standing({ uaN: 2, laN: 4, uaF: 2, laF: 4 }),
  to: standing({ uaN: 10, laN: 138, uaF: 10, laF: 138 }),
  props: [{ kind: 'dumbbell' }],
  seconds: 2.4,
};

const calfRaise = (single: boolean): Illustration => ({
  from: pose('toeN', [114, 131], { ftN: 112, ftF: single ? 60 : 112, thF: single ? -12 : -2, shF: single ? -85 : 2 }),
  to: pose('toeN', [114, 131], { ftN: 62, ftF: single ? 60 : 62, thF: single ? -12 : -2, shF: single ? -85 : 2 }),
  props: [{ kind: 'bench', x: 106, y: 134, w: 44, h: 16 }, ...(single ? [{ kind: 'dumbbell', hands: 'naer' } as Prop] : [])],
  seconds: 3,
});

const kneeToWall = (deep: boolean): Illustration => {
  const base = { torso: 176, uaN: 80, laN: 85, uaF: 80, laF: 85, thF: -28, shF: -40, ftF: 70 };
  return {
    from: pose('ankleN', [138, 147], { ...base, thN: deep ? 40 : 20, shN: 0 }),
    to: pose('ankleN', [138, 147], { ...base, thN: deep ? 60 : 38, shN: deep ? -32 : -22 }),
    props: [{ kind: 'wall', x: 176 }],
    seconds: 3,
  };
};

export const ILLUSTRATIONS: Record<string, Illustration> = {
  // ─── Ben og hofte ─────────────────────────────────────────────────────────
  rdl: {
    from: standing({ uaN: 4, laN: 4, uaF: 4, laF: 4 }),
    to: standing({ torso: 100, thN: 16, shN: -4, thF: 16, shF: -4, uaN: 0, laN: 0, uaF: 0, laF: 0 }),
    props: [{ kind: 'barbell' }],
    seconds: 3.2,
  },
  'enbens-rdl': {
    from: standing({ uaN: 2, laN: 2, uaF: 2, laF: 2, thF: -6, shF: -14 }),
    to: standing({ torso: 100, thN: 14, shN: -4, thF: -78, shF: -80, ftF: 0, uaN: 0, laN: 0, uaF: 0, laF: 0 }),
    props: [{ kind: 'dumbbell' }],
    seconds: 3.2,
  },
  'bulgarian-split-squat': {
    from: pose('ankleN', [124, 147], { torso: 176, thN: 20, shN: 0, thF: -24, shF: -112, ftF: -90, uaN: 0, laN: 0, uaF: 0, laF: 0 }),
    to: pose('ankleN', [124, 147], { torso: 168, thN: 78, shN: 8, thF: -2, shF: -108, ftF: -90, uaN: 0, laN: 0, uaF: 0, laF: 0 }),
    props: [{ kind: 'bench', x: 18, y: 116, w: 48, h: 34 }, { kind: 'dumbbell' }],
    seconds: 3,
  },
  'step-down': {
    from: pose('ankleN', [92, 131], { thF: 14, shF: 6, uaN: 40, laN: 70, uaF: 40, laF: 70 }),
    to: pose('ankleN', [92, 131], { torso: 162, thN: 52, shN: -18, thF: 42, shF: 12, uaN: 70, laN: 85, uaF: 70, laF: 85 }),
    props: [{ kind: 'bench', x: 66, y: 134, w: 48, h: 16 }],
    seconds: 3,
  },
  'hip-airplane': {
    from: standing({ torso: 102, thN: 12, shN: -4, thF: -80, shF: -82, ftF: 0, uaN: 10, laN: 10, uaF: 10, laF: 10 }),
    to: standing({ torso: 100, thN: 12, shN: -4, thF: -70, shF: -72, ftF: 0, uaN: 10, laN: 10, uaF: 165, laF: 170 }),
    seconds: 4,
  },
  'hofteflexor-march': {
    from: standing({ uaN: 20, laN: 30, uaF: -20, laF: -10 }),
    to: standing({ thF: 88, shF: 2, ftF: 92, uaN: -20, laN: -10, uaF: 20, laF: 30 }),
    props: [{ kind: 'band', a: 'ankleN', b: 'ankleF' }],
    seconds: 2.4,
  },
  adduktorklem: {
    from: pose('hip', [100, 141], { ...SUPINE }, SUPINE),
    to: pose('hip', [100, 141], { ...SUPINE, thN: 128, thF: 128 }, SUPINE),
    props: [{ kind: 'ball', at: 'kneeN', dy: 1, r: 6, front: true }],
    seconds: 2.4,
  },
  'copenhagen-plank': {
    from: pose('elbowN', [44, 146], { torso: -92, uaN: 0, laN: 90, uaF: 150, laF: 150, thN: 90, shN: 90, ftN: 180, thF: 64, shF: -95, ftF: -90 }),
    to: pose('elbowN', [44, 146], { torso: -97, uaN: 0, laN: 90, uaF: 150, laF: 150, thN: 93, shN: 93, ftN: 180, thF: 62, shF: -95, ftF: -90 }),
    props: [{ kind: 'bench', x: 122, y: 133, w: 52, h: 17 }],
    seconds: 3,
  },
  'nordic-hamstring-curl': {
    from: pose('kneeN', [118, 144], { torso: 180, thN: 0, shN: -90, ftN: 180, thF: 0, shF: -90, ftF: 180, uaN: 30, laN: 150, uaF: 30, laF: 150 }),
    to: pose('kneeN', [118, 144], { torso: 128, thN: -52, shN: -90, ftN: 180, thF: -52, shF: -90, ftF: 180, uaN: 105, laN: 100, uaF: 105, laF: 100 }),
    props: [{ kind: 'pad', at: 'ankleN' }],
    seconds: 3.6,
  },
  'glideskinne-leg-curl': {
    from: pose('shoulder', [50, 142], { torso: -55, head: -30, uaN: 60, laN: 90, uaF: 60, laF: 90, thN: 67, shN: 67, ftN: 160, thF: 67, shF: 67, ftF: 160 }),
    to: pose('shoulder', [50, 142], { torso: -50, head: -35, uaN: 60, laN: 90, uaF: 60, laF: 90, thN: 100, shN: 8, ftN: 100, thF: 100, shF: 8, ftF: 100 }),
    props: [{ kind: 'pad', at: 'ankleN' }],
    seconds: 3,
  },
  'hip-thrust': {
    from: pose('shoulder', [64, 112], { torso: -128, head: -25, thN: 106, shN: 28, thF: 106, shF: 28, uaN: 100, laN: 60, uaF: 100, laF: 60 }),
    to: pose('shoulder', [64, 112], { torso: -92, head: -40, thN: 88, shN: 4, thF: 88, shF: 4, uaN: 120, laN: 70, uaF: 120, laF: 70 }),
    props: [{ kind: 'bench', x: 14, y: 116, w: 52, h: 34 }, { kind: 'plate', at: 'hip' }],
    seconds: 2.8,
  },
  'enbens-hip-thrust': {
    from: pose('shoulder', [64, 112], { torso: -128, head: -25, thN: 106, shN: 28, thF: 150, shF: 60, uaN: 100, laN: 60, uaF: 100, laF: 60 }),
    to: pose('shoulder', [64, 112], { torso: -92, head: -40, thN: 88, shN: 4, thF: 140, shF: 70, uaN: 120, laN: 70, uaF: 120, laF: 70 }),
    props: [{ kind: 'bench', x: 14, y: 116, w: 52, h: 34 }],
    seconds: 2.8,
  },

  // ─── Læg og ankel ─────────────────────────────────────────────────────────
  'enbens-tahaev': calfRaise(true),
  'siddende-tahaev': {
    from: pose('toeN', [132, 141], { torso: 180, thN: 90, shN: 0, ftN: 115, thF: 90, shF: 0, ftF: 115, uaN: 40, laN: 90, uaF: 40, laF: 90 }),
    to: pose('toeN', [132, 141], { torso: 180, thN: 90, shN: 0, ftN: 62, thF: 90, shF: 0, ftF: 62, uaN: 40, laN: 90, uaF: 40, laF: 90 }),
    props: [{ kind: 'bench', x: 48, y: 112, w: 46, h: 38 }, { kind: 'plate', at: 'kneeN' }, { kind: 'bench', x: 122, y: 143, w: 26, h: 7 }],
    seconds: 2.6,
  },

  // ─── Ryg og træk ──────────────────────────────────────────────────────────
  rows: {
    from: pose('hip', [70, 136], { torso: 176, uaN: 92, laN: 92, uaF: 92, laF: 92, thN: 84, shN: 70, thF: 84, shF: 70, ftN: 170, ftF: 170 }),
    to: pose('hip', [70, 136], { torso: 186, uaN: -35, laN: 80, uaF: -35, laF: 80, thN: 84, shN: 70, thF: 84, shF: 70, ftN: 170, ftF: 170 }),
    props: [{ kind: 'cable', from: [192, 128], to: 'wristN' }],
    seconds: 2.8,
  },
  't-bar-row': {
    from: standing({ torso: 132, thN: 30, shN: -12, thF: 30, shF: -12, uaN: 0, laN: 0, uaF: 0, laF: 0 }),
    to: standing({ torso: 132, thN: 30, shN: -12, thF: 30, shF: -12, uaN: -55, laN: 25, uaF: -55, laF: 25 }),
    props: [{ kind: 'plate', at: 'wristN' }],
    seconds: 2.6,
  },
  'lat-pulldown': {
    from: pose('hip', [84, 108], { torso: 188, thN: 90, shN: 0, thF: 90, shF: 0, uaN: 172, laN: 176, uaF: 172, laF: 176 }),
    to: pose('hip', [84, 108], { torso: 194, thN: 90, shN: 0, thF: 90, shF: 0, uaN: 0, laN: 150, uaF: 0, laF: 150 }),
    props: [{ kind: 'bench', x: 60, y: 112, w: 46, h: 38 }, { kind: 'cable', from: [92, 4], to: 'wristN' }],
    seconds: 2.8,
  },
  'pull-up-elastik': {
    from: pose('wristN', [104, 12], { torso: 180, uaN: 176, laN: 178, uaF: 176, laF: 178, thN: 10, shN: -50, thF: 10, shF: -50, ftN: 20, ftF: 20 }),
    to: pose('wristN', [104, 12], { torso: 174, uaN: 25, laN: 170, uaF: 25, laF: 170, thN: 14, shN: -46, thF: 14, shF: -46, ftN: 20, ftF: 20 }),
    props: [{ kind: 'bar', at: [104, 12] }, { kind: 'cable', from: [104, 12], to: 'kneeN' }],
    seconds: 3,
  },
  'prone-y-t': {
    from: pose('ankleN', [52, 147], { torso: 122, head: 10, thN: -54, shN: -54, thF: -54, shF: -54, uaN: 2, laN: 2, uaF: 2, laF: 2 }),
    to: pose('ankleN', [52, 147], { torso: 122, head: 10, thN: -54, shN: -54, thF: -54, shF: -54, uaN: 132, laN: 134, uaF: 132, laF: 134 }),
    props: [{ kind: 'incline', from: [70, 150], to: [146, 92] }],
    seconds: 3,
  },
  'face-pull': {
    from: standing({ uaN: 88, laN: 92, uaF: 88, laF: 92 }),
    to: standing({ uaN: -112, laN: 120, uaF: -112, laF: 120 }),
    props: [{ kind: 'cable', from: [192, 54], to: 'wristN' }],
    seconds: 2.6,
  },

  // ─── Skuldre og arme ──────────────────────────────────────────────────────
  skulderpres: {
    from: standing({ uaN: 98, laN: 176, uaF: 98, laF: 176 }),
    to: standing({ uaN: 160, laN: 168, uaF: 160, laF: 168 }),
    props: [{ kind: 'dumbbell' }],
    seconds: 2.6,
  },
  'baenkpres-eller-armstraekninger': {
    from: pose('hip', [118, 112], { torso: -90, head: 0, thN: 52, shN: 2, thF: 52, shF: 2, uaN: 30, laN: 180, uaF: 30, laF: 180 }),
    to: pose('hip', [118, 112], { torso: -90, head: 0, thN: 52, shN: 2, thF: 52, shF: 2, uaN: 178, laN: 180, uaF: 178, laF: 180 }),
    props: [{ kind: 'bench', x: 30, y: 116, w: 100, h: 34 }, { kind: 'barbell' }],
    seconds: 2.6,
  },
  'biceps-curl': curl,
  'hammer-curl': curl,
  'triceps-pushdown': {
    from: standing({ torso: 172, uaN: 4, laN: 140, uaF: 4, laF: 140 }),
    to: standing({ torso: 172, uaN: 4, laN: 6, uaF: 4, laF: 6 }),
    props: [{ kind: 'cable', from: [150, 4], to: 'wristN' }],
    seconds: 2.4,
  },
  'overhead-triceps-extension': {
    from: standing({ uaN: 156, laN: -25, uaF: 156, laF: -25 }),
    to: standing({ uaN: 158, laN: 165, uaF: 158, laF: 165 }),
    props: [{ kind: 'dumbbell' }],
    seconds: 2.6,
  },

  // ─── Core ─────────────────────────────────────────────────────────────────
  'pallof-press': {
    from: standing({ thN: 10, shN: -8, thF: 10, shF: -8, uaN: 18, laN: 128, uaF: 18, laF: 128 }),
    to: standing({ thN: 10, shN: -8, thF: 10, shF: -8, uaN: 90, laN: 90, uaF: 90, laF: 90 }),
    props: [{ kind: 'cable', from: [8, 76], to: 'wristN' }],
    seconds: 2.8,
  },
  sideplanke: {
    from: pose('elbowN', [44, 146], { torso: -100, uaN: 0, laN: 90, uaF: 120, laF: 160, thN: 82, shN: 70, thF: 82, shF: 70, ftN: 160, ftF: 160 }),
    to: pose('elbowN', [44, 146], { torso: -107, uaN: 0, laN: 90, uaF: 120, laF: 160, thN: 76, shN: 76, thF: 76, shF: 76, ftN: 166, ftF: 166 }),
    seconds: 3,
  },

  // ─── Mobilitet ────────────────────────────────────────────────────────────
  'knae-til-vaeg-hojre': kneeToWall(false),
  'knae-til-vaeg-venstre': kneeToWall(false),
  'soleus-straek': kneeToWall(true),
  'tahaev-trin-strakt': calfRaise(false),
  'psoas-release': {
    from: pose('hip', [96, 132], { torso: -95, head: 0, uaN: 10, laN: -90, uaF: 10, laF: -90, thN: 94, shN: 92, ftN: 175, thF: 94, shF: 92, ftF: 175 }),
    to: pose('hip', [96, 130], { torso: -96, head: 0, uaN: 10, laN: -90, uaF: 10, laF: -90, thN: 95, shN: 92, ftN: 175, thF: 95, shF: 92, ftF: 175 }),
    props: [{ kind: 'ball', at: 'hip', dx: -10, dy: 9, r: 8 }],
    seconds: 4,
  },
  'hip-cars': {
    from: standing({ uaN: 30, laN: 60, uaF: 30, laF: 60, thF: 92, shF: 6 }),
    to: standing({ uaN: 30, laN: 60, uaF: 30, laF: 60, thF: -40, shF: -110 }),
    seconds: 4.4,
  },
  'hofteskift-90-90': {
    from: pose('hip', [86, 140], { torso: 180, uaN: 30, laN: 60, uaF: 30, laF: 60, thN: 132, shN: 20, thF: 132, shF: 20 }),
    to: pose('hip', [86, 140], { torso: 176, uaN: 30, laN: 60, uaF: 30, laF: 60, thN: 96, shN: -70, thF: 96, shF: -70 }),
    seconds: 3.6,
  },
  'glute-bridge': {
    from: pose('shoulder', [56, 142], { ...SUPINE, torso: -94 }, SUPINE),
    to: pose('shoulder', [56, 142], { ...SUPINE, torso: -66, thN: 104, shN: 6, thF: 104, shF: 6 }, SUPINE),
    seconds: 3,
  },
};

// Øvelser i andre planer: genkendes på navnet, så de også får en figur.
const BY_NAME: [RegExp, string][] = [
  [/enbens.*(rdl|dødløft)/i, 'enbens-rdl'],
  [/(rdl|dødløft)/i, 'rdl'],
  [/split squat|udfald/i, 'bulgarian-split-squat'],
  [/step-?down|step-?up/i, 'step-down'],
  [/hip thrust|hoftel(ø|o)ft/i, 'hip-thrust'],
  [/glute bridge|bækkenløft/i, 'glute-bridge'],
  [/nordic/i, 'nordic-hamstring-curl'],
  [/leg curl/i, 'glideskinne-leg-curl'],
  [/siddende.*tåhæv/i, 'siddende-tahaev'],
  [/tåhæv|calf raise/i, 'enbens-tahaev'],
  [/pulldown|pull-?up|chin/i, 'lat-pulldown'],
  [/t-bar/i, 't-bar-row'],
  [/row/i, 'rows'],
  [/face pull/i, 'face-pull'],
  [/skulderpres|shoulder press/i, 'skulderpres'],
  [/bænkpres|bench|armstræk|push-?up/i, 'baenkpres-eller-armstraekninger'],
  [/pushdown/i, 'triceps-pushdown'],
  [/triceps/i, 'overhead-triceps-extension'],
  [/curl/i, 'biceps-curl'],
  [/sideplank/i, 'sideplanke'],
  [/copenhagen/i, 'copenhagen-plank'],
  [/pallof/i, 'pallof-press'],
];

/** Illustrationen til en øvelse eller et mobilitetspunkt: på id, ellers på navnet. */
export function illustrationFor(id: string, name?: string): Illustration | undefined {
  if (ILLUSTRATIONS[id]) return ILLUSTRATIONS[id];
  const hit = name && BY_NAME.find(([re]) => re.test(name));
  return hit ? ILLUSTRATIONS[hit[1]] : undefined;
}
