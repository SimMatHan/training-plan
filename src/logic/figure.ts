// Tændstiksmænd til øvelsesillustrationer. En stilling er vinkler for hvert kropsled (set fra
// siden, figuren vender mod højre) plus ét led, der står fast på et bestemt punkt (fx foden på
// gulvet). Animationen interpolerer vinklerne, så lemmerne bevarer deres længde, og det faste led
// bliver stående.
//
// Vinkler er absolutte i grader: 0 = lige ned, 90 = frem (mod højre), 180 = lige op, -90 = bagud.

export type Point = readonly [number, number];

export type Joint =
  | 'head'
  | 'neck'
  | 'shoulder'
  | 'hip'
  | 'elbowN'
  | 'wristN'
  | 'elbowF'
  | 'wristF'
  | 'kneeN'
  | 'ankleN'
  | 'toeN'
  | 'kneeF'
  | 'ankleF'
  | 'toeF';

/** Vinkler for én stilling. N = nærmeste side (tegnes tydeligt), F = fjerneste (tegnes svagt). */
export interface Angles {
  torso: number;
  /** Hovedets hældning i forhold til kroppen. */
  head?: number;
  uaN: number;
  laN: number;
  uaF: number;
  laF: number;
  thN: number;
  shN: number;
  ftN?: number;
  thF: number;
  shF: number;
  ftF?: number;
}

export interface Pose extends Angles {
  /** Leddet der står fast, og hvor. */
  anchor: Joint;
  at: Point;
}

export type Skeleton = Record<Joint, Point>;

// Segmentlængder i viewBox-enheder (200 × 160, gulvet ved y = 150).
export const LEN = { torso: 40, shoulder: 35, neck: 5, head: 8, upperArm: 21, forearm: 20, thigh: 33, shin: 31, foot: 10 } as const;

const rad = (deg: number) => (deg * Math.PI) / 180;
const step = ([x, y]: Point, deg: number, len: number): Point => [x + Math.sin(rad(deg)) * len, y + Math.cos(rad(deg)) * len];

/** Leddenes placering, når hoften står i (0, 0). */
function fromHip(a: Angles): Skeleton {
  const hip: Point = [0, 0];
  const shoulder = step(hip, a.torso, LEN.shoulder);
  const neck = step(hip, a.torso, LEN.torso);
  const head = step(neck, a.torso + (a.head ?? 0), LEN.neck + LEN.head);
  const elbowN = step(shoulder, a.uaN, LEN.upperArm);
  const elbowF = step(shoulder, a.uaF, LEN.upperArm);
  const kneeN = step(hip, a.thN, LEN.thigh);
  const kneeF = step(hip, a.thF, LEN.thigh);
  const ankleN = step(kneeN, a.shN, LEN.shin);
  const ankleF = step(kneeF, a.shF, LEN.shin);
  return {
    hip,
    shoulder,
    neck,
    head,
    elbowN,
    elbowF,
    wristN: step(elbowN, a.laN, LEN.forearm),
    wristF: step(elbowF, a.laF, LEN.forearm),
    kneeN,
    kneeF,
    ankleN,
    ankleF,
    toeN: step(ankleN, a.ftN ?? 90, LEN.foot),
    toeF: step(ankleF, a.ftF ?? 90, LEN.foot),
  };
}

/** Skelettet for en stilling, flyttet så det faste led står på sit punkt. */
export function solve(pose: Pose): Skeleton {
  const s = fromHip(pose);
  const [ax, ay] = s[pose.anchor];
  const dx = pose.at[0] - ax;
  const dy = pose.at[1] - ay;
  return Object.fromEntries(Object.entries(s).map(([k, [x, y]]) => [k, [x + dx, y + dy]])) as unknown as Skeleton;
}

const ANGLE_KEYS = ['torso', 'head', 'uaN', 'laN', 'uaF', 'laF', 'thN', 'shN', 'ftN', 'thF', 'shF', 'ftF'] as const;
const DEFAULTS: Partial<Record<(typeof ANGLE_KEYS)[number], number>> = { head: 0, ftN: 90, ftF: 90 };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Stillingen en brøkdel t (0–1) af vejen fra a til b. Det faste led følger a. */
export function blend(a: Pose, b: Pose, t: number): Pose {
  const out = { anchor: a.anchor, at: [lerp(a.at[0], b.at[0], t), lerp(a.at[1], b.at[1], t)] as Point } as Pose;
  for (const k of ANGLE_KEYS) (out as unknown as Record<string, number>)[k] = lerp(a[k] ?? DEFAULTS[k] ?? 0, b[k] ?? DEFAULTS[k] ?? 0, t);
  return out;
}

/** Blød frem-og-tilbage: 0 → 1 → 0 over én periode, med et lille ophold i hver ende. */
export function pingPong(phase: number): number {
  const p = phase % 1;
  const x = p < 0.5 ? p * 2 : (1 - p) * 2;
  const held = Math.min(1, Math.max(0, (x - 0.08) / 0.84));
  return (1 - Math.cos(Math.PI * held)) / 2;
}
