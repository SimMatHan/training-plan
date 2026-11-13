// Mobilitetsblokken som tidsstyret rutine, så den kan køres i yoga-afspilleren (stor figur, nedtælling og lyd)
// i stedet for som tjekliste. Tiden pr. punkt læses ud af doseringen ("40 sek pr. side", "2 × 8/side",
// "8 langsomme gentagelser"); gentagelser regnes om til et skøn over tiden. Ren logik, delt af app og tests.
import type { MobilityItem, Plan, YogaPose, YogaRoutine } from './plan.schema';

/** Sekunder pr. gentagelse, når doseringen er i gentagelser og intet tempo er angivet. */
export const SEC_PER_REP = 3;
/** "Langsomme" gentagelser. */
export const SEC_PER_SLOW_REP = 5;
/** Når doseringen ikke kan læses. */
export const FALLBACK_SEC = 45;

const MIN = 10;
const MAX = 600;
const CUE_MAX = 300;

const round5 = (n: number) => Math.round(n / 5) * 5;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (s: string) => Number(s.replace(',', '.'));

export interface DoseTime {
  /** Sekunder pr. side (perSide) eller i alt. */
  seconds: number;
  perSide: boolean;
  /** Tiden er et skøn ud fra gentagelser (doseringen vises da under stillingen). */
  estimated: boolean;
}

/** Tiden for ét mobilitetspunkt ud fra doseringen. */
export function doseTime(dose: string): DoseTime {
  const d = dose.toLowerCase();
  const perSide = /pr\.?\s*side|\/\s*side|hver side|per side/.test(d);
  const done = (seconds: number, estimated: boolean): DoseTime => ({ seconds: clamp(round5(seconds), MIN, MAX), perSide, estimated });

  // Sæt × tid: "2 × 15 sek", "3 x 30 s/side".
  const setsTime = d.match(/(\d+)\s*[×x]\s*(\d+(?:[.,]\d+)?)\s*(sek|sec|s\b|min)/);
  if (setsTime) return done(num(setsTime[1]) * num(setsTime[2]) * (setsTime[3] === 'min' ? 60 : 1), false);

  // Sæt × gentagelser: "2 × 8/side, 3 sek ned", "3 × 10".
  const setsReps = d.match(/(\d+)\s*[×x]\s*(\d+)(?:\s*[–-]\s*(\d+))?/);
  if (setsReps) {
    const reps = num(setsReps[3] ?? setsReps[2]);
    return done(num(setsReps[1]) * reps * repSeconds(d), true);
  }

  // Tider, evt. flere lagt sammen: "30 sek pedalering + 30 sek hold", "60 sek", "2 min".
  const times = [...d.matchAll(/(\d+(?:[.,]\d+)?)\s*(sek|sec|s\b|min)/g)];
  if (times.length) return done(times.reduce((a, m) => a + num(m[1]) * (m[2] === 'min' ? 60 : 1), 0), false);

  // Gentagelser: "8 langsomme gentagelser", "10 reps", "6/side".
  const reps = d.match(/(\d+)\s*(?:\/\s*side|[a-zæøå]*\s*(?:gentagelser|gange|reps?|rep\b))/);
  if (reps) return done(num(reps[1]) * repSeconds(d), true);

  return done(FALLBACK_SEC, true);
}

/** Sekunder pr. gentagelse: "3 sek ned" og "2 sek hold" lægges til et kort løft; "langsom" giver mere. */
function repSeconds(d: string): number {
  const tempo = [...d.matchAll(/(\d+)\s*sek\.?\s*(ned|hold|op|pause)/g)].reduce((a, m) => a + num(m[1]), 0);
  if (tempo) return tempo + 1;
  return /langsom/.test(d) ? SEC_PER_SLOW_REP : SEC_PER_REP;
}

/** Ét punkt som stilling i rutinen. Id og navn følger punktet (figuren findes ud fra dem). */
export function poseFromItem(item: MobilityItem): YogaPose {
  const t = doseTime(item.dose);
  const cue = [item.dose, item.cue].filter(Boolean).join('. ');
  return {
    poseId: item.id,
    name: item.name,
    seconds: t.seconds,
    perSide: t.perSide,
    ...(cue && { cue: cue.length > CUE_MAX ? `${cue.slice(0, CUE_MAX - 1)}…` : cue }),
  };
}

/** Planens mobilitetsblok som rutine til afspilleren, eller undefined uden blok. */
export function routineFromMobility(plan: Pick<Plan, 'mobility'>): YogaRoutine | undefined {
  const block = plan.mobility;
  if (!block?.items.length) return undefined;
  return { areas: [], transitionSec: 3, poses: block.items.map(poseFromItem) };
}

/**
 * De punkter, der er nået igennem efter `poseIndex` stillinger (til at krydse af, når rutinen gemmes):
 * alle, hvis rutinen er kørt færdig.
 */
export function itemsDone(plan: Pick<Plan, 'mobility'>, reachedPoses: number, complete: boolean): string[] {
  const items = plan.mobility?.items ?? [];
  return (complete ? items : items.slice(0, Math.max(0, reachedPoses))).map((i) => i.id);
}
