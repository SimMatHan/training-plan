// Yoga- og mobilitetsrutiner: katalog over stillinger, generator der bygger en rutine ud fra varighed og
// områder (med ekstra tid på den stramme side), og tidslinjen som afspilleren, TV-visningen og lydene følger.
// Ren logik uden afhængigheder ud over typerne, så appen, Worker'en og MCP-værktøjerne deler den.
import type { Side, Week, YogaArea, YogaPose, YogaRoutine } from './plan.schema';

export type { YogaArea, YogaPose, YogaRoutine };

// ─── Områder ────────────────────────────────────────────────────────────────

export const YOGA_AREAS = ['hofter', 'hoftebojere', 'baglaar', 'lyske', 'ankler', 'laend', 'brystryg', 'skuldre', 'nakke'] as const;

export const AREA_LABEL: Record<YogaArea, string> = {
  hofter: 'hofter (rotation og balder)',
  hoftebojere: 'hoftebøjere',
  baglaar: 'baglår',
  lyske: 'lyske og adduktorer',
  ankler: 'ankler og læg',
  laend: 'lænd',
  brystryg: 'brystryg (thorax)',
  skuldre: 'skuldre og bryst',
  nakke: 'nakke',
};

/** Korte navne til titler, fx "Yoga · hofter og ankler". */
export const AREA_SHORT: Record<YogaArea, string> = {
  hofter: 'hofter',
  hoftebojere: 'hoftebøjere',
  baglaar: 'baglår',
  lyske: 'lyske',
  ankler: 'ankler',
  laend: 'lænd',
  brystryg: 'brystryg',
  skuldre: 'skuldre',
  nakke: 'nakke',
};

// ─── Katalog ────────────────────────────────────────────────────────────────

export type PoseRole = 'aabning' | 'fokus' | 'afslutning';

export interface CatalogPose {
  id: string;
  name: string;
  /** Det internationale navn, fx "Pigeon". */
  alias?: string;
  areas: YogaArea[];
  perSide: boolean;
  /** Standardtid pr. side i sekunder. */
  seconds: number;
  role: PoseRole;
  cue: string;
}

export const YOGA_POSES: CatalogPose[] = [
  { id: 'kat-ko', name: 'Kat-ko', alias: 'Cat-cow', areas: ['brystryg', 'laend'], perSide: false, seconds: 45, role: 'aabning', cue: 'Rund ryggen på udånding, svaj på indånding. Følg vejret.' },
  { id: 'barnets-stilling', name: 'Barnets stilling', alias: "Child's pose", areas: ['laend', 'hofter', 'skuldre'], perSide: false, seconds: 60, role: 'aabning', cue: 'Knæene brede, panden i gulvet, armene langt frem. Ånd ned i lænden.' },
  { id: 'nedadgaaende-hund', name: 'Nedadgående hund', alias: 'Downward dog', areas: ['baglaar', 'ankler', 'skuldre'], perSide: false, seconds: 45, role: 'fokus', cue: 'Hofterne op og bagud. Træd skiftevis hælene mod gulvet.' },
  { id: 'traad-naalen', name: 'Tråd nålen', alias: 'Thread the needle', areas: ['brystryg', 'skuldre'], perSide: true, seconds: 40, role: 'fokus', cue: 'Fra firfodsstående: før armen ind under kroppen og læg skulderen i gulvet.' },
  { id: 'lavt-udfald', name: 'Lavt udfald', alias: 'Low lunge', areas: ['hoftebojere'], perSide: true, seconds: 45, role: 'fokus', cue: 'Bagerste knæ i gulvet. Spænd ballen og skub hoften frem; ryggen er rank.' },
  { id: 'couch-straek', name: 'Sofastræk', alias: 'Couch stretch', areas: ['hoftebojere'], perSide: true, seconds: 60, role: 'fokus', cue: 'Bagerste fod op ad væggen eller sofaen. Bækkenet vippet ind under, ballen spændt.' },
  { id: 'halv-split', name: 'Halv split', alias: 'Half split', areas: ['baglaar'], perSide: true, seconds: 45, role: 'fokus', cue: 'Forreste ben strakt, flex foden. Bøj frem fra hoften med lang ryg.' },
  { id: 'staaende-fremadboejning', name: 'Stående fremadbøjning', alias: 'Forward fold', areas: ['baglaar', 'laend'], perSide: false, seconds: 45, role: 'fokus', cue: 'Bløde knæ, lad overkroppen hænge tungt. Ryst hovedet let.' },
  { id: 'liggende-baglaarsstraek', name: 'Liggende baglårsstræk', alias: 'Supine hamstring stretch', areas: ['baglaar'], perSide: true, seconds: 45, role: 'fokus', cue: 'Elastik eller rem om foden. Benet så strakt det kan; det andet ben ligger i gulvet.' },
  { id: 'due', name: 'Due', alias: 'Pigeon', areas: ['hofter'], perSide: true, seconds: 60, role: 'fokus', cue: 'Forreste skinneben på tværs, bagerste ben langt bagud. Hold hofterne lige og sænk overkroppen.' },
  { id: 'hofte-90-90', name: '90/90-siddende', alias: '90/90', areas: ['hofter'], perSide: true, seconds: 60, role: 'fokus', cue: 'Begge knæ i 90 grader. Sid højt og læn dig frem over forreste skinneben.' },
  { id: 'liggende-figur-4', name: 'Liggende figur-4', alias: 'Eye of the needle', areas: ['hofter'], perSide: true, seconds: 60, role: 'fokus', cue: 'Ankel over modsatte knæ. Træk låret mod brystet; skuldrene bliver i gulvet.' },
  { id: 'firben', name: 'Firben', alias: 'Lizard', areas: ['hofter', 'hoftebojere', 'lyske'], perSide: true, seconds: 45, role: 'fokus', cue: 'Forreste fod uden for hånden. Sænk hoften; albuerne mod gulvet, hvis det går.' },
  { id: 'glad-baby', name: 'Glad baby', alias: 'Happy baby', areas: ['hofter', 'lyske', 'laend'], perSide: false, seconds: 60, role: 'fokus', cue: 'Hold om fødderne, knæene mod armhulerne. Lænden tung i gulvet; vug blødt.' },
  { id: 'sommerfugl', name: 'Sommerfugl', alias: 'Butterfly', areas: ['lyske'], perSide: false, seconds: 60, role: 'fokus', cue: 'Fodsålerne mod hinanden. Lang ryg, bøj frem fra hoften; pres ikke knæene ned.' },
  { id: 'froe', name: 'Frøen', alias: 'Frog', areas: ['lyske'], perSide: false, seconds: 60, role: 'fokus', cue: 'Knæene brede, anklerne i linje med knæene. Skub hoften langsomt bagud.' },
  { id: 'bred-fremadboejning', name: 'Bred fremadbøjning', alias: 'Wide-legged forward bend', areas: ['lyske', 'baglaar'], perSide: false, seconds: 60, role: 'fokus', cue: 'Siddende med benene bredt. Tæerne peger op; gå frem med hænderne.' },
  { id: 'malasana', name: 'Yogisquat', alias: 'Malasana', areas: ['ankler', 'hofter', 'lyske'], perSide: false, seconds: 45, role: 'fokus', cue: 'Dyb squat med hælene i gulvet (læg evt. noget under). Albuerne presser knæene ud.' },
  { id: 'ankel-udfald', name: 'Knæ over tå', alias: 'Kneeling ankle rock', areas: ['ankler'], perSide: true, seconds: 40, role: 'fokus', cue: 'Halvt knælende. Før knæet frem over tæerne med hælen i gulvet; vug roligt.' },
  { id: 'diamantsiddende', name: 'Diamantsiddende', alias: 'Vajrasana', areas: ['ankler'], perSide: false, seconds: 45, role: 'fokus', cue: 'Sid på hælene med vristen i gulvet. Læn dig let bagud for mere stræk foran anklen.' },
  { id: 'sfinks', name: 'Sfinks', alias: 'Sphinx', areas: ['laend', 'brystryg'], perSide: false, seconds: 60, role: 'fokus', cue: 'På maven med albuerne under skuldrene. Brystet frem, skuldrene væk fra ørerne.' },
  { id: 'hvalp', name: 'Hvalpestilling', alias: 'Puppy pose', areas: ['skuldre', 'brystryg'], perSide: false, seconds: 45, role: 'fokus', cue: 'Hofterne over knæene, armene langt frem. Lad brystet synke mod gulvet.' },
  { id: 'koe-ansigt-arme', name: 'Ko-ansigt-arme', alias: 'Gomukhasana arms', areas: ['skuldre'], perSide: true, seconds: 40, role: 'fokus', cue: 'Den ene hånd ned bag nakken, den anden op ad ryggen. Brug et håndklæde, hvis hænderne ikke mødes.' },
  { id: 'brystaabner-vaeg', name: 'Bryståbner ved væggen', alias: 'Doorway stretch', areas: ['skuldre'], perSide: true, seconds: 40, role: 'fokus', cue: 'Underarmen mod væggen, albuen i skulderhøjde. Drej kroppen væk.' },
  { id: 'aaben-bog', name: 'Åben bog', alias: 'Open book', areas: ['brystryg'], perSide: true, seconds: 45, role: 'fokus', cue: 'Sideliggende med bøjede knæ. Åbn den øverste arm over mod gulvet bag dig; følg hånden med blikket.' },
  { id: 'nakkestraek', name: 'Nakkestræk', alias: 'Neck side stretch', areas: ['nakke'], perSide: true, seconds: 30, role: 'fokus', cue: 'Øret mod skulderen, den modsatte skulder tung. Hånden må hvile let på hovedet.' },
  { id: 'siddende-sidebojning', name: 'Siddende sidebøjning', alias: 'Seated side bend', areas: ['laend', 'brystryg'], perSide: true, seconds: 40, role: 'fokus', cue: 'Siddende med kryds. Armen op og over til siden; begge sædeben i gulvet.' },
  { id: 'liggende-twist', name: 'Liggende rygvrid', alias: 'Supine twist', areas: ['laend', 'brystryg', 'hofter'], perSide: true, seconds: 60, role: 'afslutning', cue: 'Knæene over til siden, armene ud. Blikket den anden vej; skuldrene i gulvet.' },
  { id: 'ben-op-ad-vaeggen', name: 'Ben op ad væggen', alias: 'Legs up the wall', areas: ['laend'], perSide: false, seconds: 90, role: 'afslutning', cue: 'Bagdelen tæt ved væggen, benene op. Slip alt og ånd langsomt.' },
  { id: 'savasana', name: 'Hvilestilling', alias: 'Savasana', areas: [], perSide: false, seconds: 60, role: 'afslutning', cue: 'Lig på ryggen, slip armene ud til siden. Luk øjnene og lad kroppen blive tung.' },
];

const BY_ID = new Map(YOGA_POSES.map((p) => [p.id, p]));

export const catalogPose = (id: string): CatalogPose | undefined => BY_ID.get(id);

/** Stillinger pr. område, bedste først. Generatoren tager dem i den rækkefølge. */
export const AREA_POSES: Record<YogaArea, string[]> = {
  hofter: ['due', 'hofte-90-90', 'liggende-figur-4', 'firben', 'glad-baby', 'malasana'],
  hoftebojere: ['lavt-udfald', 'couch-straek', 'firben'],
  baglaar: ['halv-split', 'nedadgaaende-hund', 'liggende-baglaarsstraek', 'staaende-fremadboejning', 'bred-fremadboejning'],
  lyske: ['sommerfugl', 'froe', 'bred-fremadboejning', 'firben', 'malasana', 'glad-baby'],
  ankler: ['ankel-udfald', 'malasana', 'nedadgaaende-hund', 'diamantsiddende'],
  laend: ['sfinks', 'siddende-sidebojning', 'glad-baby', 'staaende-fremadboejning'],
  brystryg: ['traad-naalen', 'aaben-bog', 'sfinks', 'hvalp', 'siddende-sidebojning'],
  skuldre: ['hvalp', 'koe-ansigt-arme', 'brystaabner-vaeg', 'traad-naalen'],
  nakke: ['nakkestraek'],
};

/** Uden angivne områder: en alsidig rutine til løbere og styrkeløftere. */
export const DEFAULT_AREAS: YogaArea[] = ['hofter', 'hoftebojere', 'baglaar', 'brystryg'];

// ─── Tider ──────────────────────────────────────────────────────────────────

/** "Gør dig klar" før første stilling. */
export const READY_SEC = 10;
/** Pause til at skifte side i en ensidig stilling. */
export const SWITCH_SEC = 5;
export const DEFAULT_TRANSITION_SEC = 6;
export const MIN_HOLD = 20;
export const MAX_HOLD = 180;
/** Den stramme side får så meget længere tid. */
export const TIGHT_FACTOR = 1.5;

export const poseName = (p: Pick<YogaPose, 'poseId' | 'name'>) => p.name ?? catalogPose(p.poseId)?.name ?? p.poseId;
export const posePerSide = (p: Pick<YogaPose, 'poseId' | 'perSide'>) => p.perSide ?? catalogPose(p.poseId)?.perSide ?? false;
export const poseCue = (p: Pick<YogaPose, 'poseId' | 'cue'>) => p.cue ?? catalogPose(p.poseId)?.cue;

/** Siderne i den rækkefølge de tages: den med længst tid (den stramme) først, ellers højre først. */
export function poseSides(p: YogaPose): { side: Side | null; seconds: number }[] {
  if (!posePerSide(p)) return [{ side: null, seconds: p.seconds }];
  const h = p.sideSeconds?.H ?? p.seconds;
  const v = p.sideSeconds?.V ?? p.seconds;
  const sides = [
    { side: 'H' as const, seconds: h },
    { side: 'V' as const, seconds: v },
  ];
  return v > h ? sides.reverse() : sides;
}

// ─── Tidslinje ──────────────────────────────────────────────────────────────

export type StepKind = 'klar' | 'stilling' | 'skift' | 'overgang';

export interface YogaStep {
  kind: StepKind;
  /** Stillingen der holdes, eller (klar/overgang/skift) den der kommer. */
  poseIndex: number;
  side: Side | null;
  seconds: number;
  startMs: number;
}

export const SIDE_LABEL: Record<Side, string> = { H: 'højre side', V: 'venstre side' };

/** Trinene i rutinen: klar, stilling (pr. side med skift imellem), overgang til næste stilling, … */
export function buildSteps(routine: YogaRoutine): YogaStep[] {
  const steps: YogaStep[] = [];
  let t = 0;
  const push = (kind: StepKind, poseIndex: number, side: Side | null, seconds: number) => {
    if (seconds <= 0) return;
    steps.push({ kind, poseIndex, side, seconds, startMs: t });
    t += seconds * 1000;
  };
  const transition = routine.transitionSec ?? DEFAULT_TRANSITION_SEC;
  routine.poses.forEach((pose, i) => {
    const sides = poseSides(pose);
    push(i === 0 ? 'klar' : 'overgang', i, sides[0].side, i === 0 ? READY_SEC : transition);
    sides.forEach((s, j) => {
      if (j > 0) push('skift', i, s.side, SWITCH_SEC);
      push('stilling', i, s.side, s.seconds);
    });
  });
  return steps;
}

export const totalMs = (steps: YogaStep[]) => {
  const last = steps.at(-1);
  return last ? last.startMs + last.seconds * 1000 : 0;
};

/** Rutinens samlede varighed i sekunder, inklusive klar, skift og overgange. */
export const routineSeconds = (routine: YogaRoutine) => Math.round(totalMs(buildSteps(routine)) / 1000);

export interface YogaPosition {
  index: number;
  step: YogaStep | undefined;
  /** Tid tilbage i trinnet. */
  remainingMs: number;
  elapsedMs: number;
  totalMs: number;
  done: boolean;
}

/** Hvor i rutinen man er efter `elapsedMs`. */
export function positionAt(steps: YogaStep[], elapsedMs: number): YogaPosition {
  const total = totalMs(steps);
  const e = Math.max(0, Math.min(elapsedMs, total));
  if (e >= total) return { index: steps.length, step: undefined, remainingMs: 0, elapsedMs: total, totalMs: total, done: true };
  let index = steps.findIndex((s) => e < s.startMs + s.seconds * 1000);
  if (index < 0) index = steps.length - 1;
  const step = steps[index];
  return { index, step, remainingMs: step.startMs + step.seconds * 1000 - e, elapsedMs: e, totalMs: total, done: false };
}

/** Starten af næste/forrige stilling (til knapperne ⏮ ⏭). Springer over klar/overgang/skift. */
export function skipTarget(steps: YogaStep[], elapsedMs: number, dir: 1 | -1): number {
  const { index } = positionAt(steps, elapsedMs);
  if (dir === 1) {
    const next = steps.findIndex((s, i) => i > index && s.kind === 'stilling');
    return next < 0 ? totalMs(steps) : steps[next].startMs;
  }
  // Tilbage: til starten af denne stilling, eller den forrige, hvis man lige er startet.
  const holdStarts = steps.filter((s, i) => s.kind === 'stilling' && (i < index || (i === index && elapsedMs - s.startMs > 3000)));
  const target = holdStarts.at(-1);
  return target ? target.startMs : 0;
}

// ─── Lyde ───────────────────────────────────────────────────────────────────

export type YogaSound = 'klar' | 'start' | 'skift' | 'naeste' | 'tick' | 'halvvejs' | 'faerdig';

export interface YogaCue {
  atMs: number;
  sound: YogaSound;
  /** Tekst til oplæsning (valgfri stemme). */
  say?: string;
}

/**
 * Lydene langs tidslinjen: en klokke og stillingens navn ved hver overgang, en dobbelttone ved skift
 * af side, tre tik før en stilling starter og en tone når den starter, en blød tone halvvejs i lange
 * hold og en gong til sidst.
 */
export function cuesFor(routine: YogaRoutine, steps = buildSteps(routine)): YogaCue[] {
  const cues: YogaCue[] = [];
  for (const s of steps) {
    const pose = routine.poses[s.poseIndex];
    const name = poseName(pose);
    const side = s.side ? `. ${SIDE_LABEL[s.side].replace(/^./, (c) => c.toUpperCase())}` : '';
    const end = s.startMs + s.seconds * 1000;
    if (s.kind === 'klar') cues.push({ atMs: s.startMs, sound: 'klar', say: `Gør dig klar. Første stilling: ${name}${side}` });
    if (s.kind === 'overgang') cues.push({ atMs: s.startMs, sound: 'naeste', say: `Næste: ${name}${side}` });
    if (s.kind === 'skift') cues.push({ atMs: s.startMs, sound: 'skift', say: 'Skift side' });
    if (s.kind === 'stilling') {
      cues.push({ atMs: s.startMs, sound: 'start' });
      if (s.seconds >= 60) cues.push({ atMs: s.startMs + Math.round(s.seconds / 2) * 1000, sound: 'halvvejs' });
    } else {
      for (let k = 3; k >= 1; k--) if (s.seconds > k) cues.push({ atMs: end - k * 1000, sound: 'tick' });
    }
  }
  cues.push({ atMs: totalMs(steps), sound: 'faerdig', say: 'Færdig. Godt arbejde.' });
  return cues;
}

// ─── Generator ──────────────────────────────────────────────────────────────

const round5 = (n: number) => Math.round(n / 5) * 5;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface BuildOptions {
  minutes: number;
  /** Områderne der skal mest fokus på, vigtigste først. Tom: en alsidig rutine. */
  areas: YogaArea[];
  /** Den stramme side pr. område (fx fra en mobilitetstest): får længere tid og tages først. */
  tight?: Partial<Record<YogaArea, Side>>;
  transitionSec?: number;
}

/**
 * Bygger en rutine der rammer `minutes`: åbning, stillinger til områderne på skift (vigtigste først),
 * og afslutning. Holdetiderne skaleres til sidst, så den samlede tid passer (højst ±5 s pr. stilling).
 */
export function buildYogaRoutine(opts: BuildOptions): YogaRoutine {
  const budget = Math.max(5, opts.minutes) * 60;
  const transitionSec = opts.transitionSec ?? DEFAULT_TRANSITION_SEC;
  const areas = [...new Set(opts.areas.length ? opts.areas : DEFAULT_AREAS)];
  const short = opts.minutes < 12;
  const opening = short ? ['kat-ko'] : ['barnets-stilling', 'kat-ko'];
  const closing = short ? ['savasana'] : ['liggende-twist', 'savasana'];
  const used = new Set([...opening, ...closing]);

  const tightFor = (id: string): Side | undefined => {
    const p = catalogPose(id)!;
    for (const a of areas) if (p.areas.includes(a) && opts.tight?.[a]) return opts.tight[a];
    return undefined;
  };
  const cost = (id: string) => {
    const p = catalogPose(id)!;
    const extra = p.perSide && tightFor(id) ? p.seconds * (TIGHT_FACTOR - 1) : 0;
    return p.seconds * (p.perSide ? 2 : 1) + extra + (p.perSide ? SWITCH_SEC : 0) + transitionSec;
  };

  let total = READY_SEC + [...opening, ...closing].reduce((s, id) => s + cost(id), 0) - transitionSec;
  const focus: string[] = [];
  // På skift mellem områderne, så længe der er tid. Det første område får første plads i hver runde.
  const fill = (list: YogaArea[], atLeastOne: boolean) => {
    for (let round = 0, added = true; added; round++) {
      added = false;
      for (const area of list) {
        const id = AREA_POSES[area].find((x) => !used.has(x));
        if (!id) continue;
        // Mindst én stilling pr. fokusområde, også hvis tiden er knap (der skaleres ned bagefter).
        if (total + cost(id) > budget && !(atLeastOne && round === 0 && total + cost(id) * 0.6 <= budget)) continue;
        used.add(id);
        focus.push(id);
        total += cost(id);
        added = true;
      }
    }
  };
  fill(areas, true);
  const focusIds = new Set(focus);
  // Fokusstillingerne må holdes op til dobbelt så længe. Er der stadig tid, kommer resten af kroppen med.
  const stretch = focus.reduce((a, id) => a + (cost(id) - transitionSec - (catalogPose(id)!.perSide ? SWITCH_SEC : 0)), 0);
  total += stretch;
  fill([...new Set([...DEFAULT_AREAS, ...YOGA_AREAS])], false);

  const ids = [...opening, ...focus, ...closing];
  const poses: YogaPose[] = ids.map((id) => {
    const p = catalogPose(id)!;
    const tight = p.perSide ? tightFor(id) : undefined;
    return {
      poseId: id,
      seconds: p.seconds,
      ...(tight && { sideSeconds: { [tight]: round5(p.seconds * TIGHT_FACTOR) } }),
    };
  });

  // Skalér holdetiderne, så rutinen rammer budgettet: fokusstillingerne først; de øvrige kun, hvis tiden er knap
  // eller fokus allerede er holdt længst muligt.
  const routine: YogaRoutine = { areas: opts.areas, transitionSec, poses };
  const holdOf = (p: YogaPose) => poseSides(p).reduce((a, x) => a + x.seconds, 0);
  const sum = (list: YogaPose[]) => list.reduce((a, p) => a + holdOf(p), 0);
  const overhead = routineSeconds(routine) - sum(poses);
  const isFocus = (p: YogaPose) => focusIds.has(p.poseId);
  const scaleAll = (list: YogaPose[], factor: number) => {
    for (const p of list) {
      p.seconds = clamp(round5(p.seconds * factor), MIN_HOLD, p.poseId === 'savasana' ? 300 : MAX_HOLD);
      if (p.sideSeconds) for (const k of Object.keys(p.sideSeconds) as Side[]) p.sideSeconds[k] = clamp(round5(p.sideSeconds[k]! * factor), MIN_HOLD, MAX_HOLD);
    }
  };
  const others = poses.filter((p) => !isFocus(p));
  const focused = poses.filter(isFocus);
  const free = budget - overhead - sum(others);
  if (focused.length && free >= sum(focused)) scaleAll(focused, Math.min(free / sum(focused), 2));
  const rest = budget - (routineSeconds(routine) - sum(others));
  scaleAll(others, rest / sum(others));
  // Resten lægges på hvilestillingen til sidst.
  const last = poses.at(-1)!;
  last.seconds = clamp(round5(last.seconds + budget - routineSeconds(routine)), MIN_HOLD, 300);
  return routine;
}

/** "Yoga · hofter og ankler". */
export function defaultYogaName(areas: YogaArea[]): string {
  const names = [...new Set(areas)].slice(0, 3).map((a) => AREA_SHORT[a]);
  if (!names.length) return 'Yoga · hele kroppen';
  return `Yoga · ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} og ${names.at(-1)}`}`;
}

// ─── Mobilitetstests → områder ──────────────────────────────────────────────

const TEST_AREAS: [RegExp, YogaArea][] = [
  [/knee.?to.?wall|knæ.?til.?væg|ankel|dorsifle|achilles|læg|soleus|lunge test/i, 'ankler'],
  [/thomas|hoftebøj|hip flexor|psoas|rectus/i, 'hoftebojere'],
  [/sit.?and.?reach|baglår|hamstring|\bslr\b|straight.?leg|fremadbøj|toe.?touch/i, 'baglaar'],
  [/lyske|adduktor|butterfly|sommerfugl|frog|straddle/i, 'lyske'],
  [/hofte|hip|90.?90|figur.?4|faber|piriformis/i, 'hofter'],
  [/skulder|shoulder|overhead|apley|arm/i, 'skuldre'],
  [/thorax|thoracic|brystryg|rotation|vrid/i, 'brystryg'],
  [/lænd|lumbal|lower back/i, 'laend'],
  [/nakke|neck|cervical/i, 'nakke'],
];

/** Området en mobilitetstest handler om, ud fra navn og instruktion. */
export function areaForTest(name: string, instructions?: string | null): YogaArea | undefined {
  const text = `${name} ${instructions ?? ''}`;
  return TEST_AREAS.find(([re]) => re.test(name))?.[1] ?? TEST_AREAS.find(([re]) => re.test(text))?.[1];
}

export interface TestInsight {
  test: string;
  area: YogaArea;
  /** Den mindst mobile side, hvis forskellen er tydelig (laveste værdi; for de fleste tests betyder højere mere bevægelighed). */
  tightSide?: Side;
  note: string;
}

const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/** Hvad mobilitetstestene siger om, hvor der skal fokus, og hvilken side der er stram. */
export function insightsFromTests(
  tests: { name: string; unit: string; per_side: boolean; active: boolean; instructions?: string | null; last?: { right: number | null; left: number | null; value: number | null } }[],
): TestInsight[] {
  const out: TestInsight[] = [];
  for (const t of tests) {
    if (!t.active) continue;
    const area = areaForTest(t.name, t.instructions);
    if (!area) continue;
    const r = t.last?.right;
    const l = t.last?.left;
    if (t.per_side && r != null && l != null) {
      const threshold = Math.max(0.5, 0.1 * Math.max(Math.abs(r), Math.abs(l)));
      const tight: Side | undefined = Math.abs(l - r) >= threshold ? (r < l ? 'H' : 'V') : undefined;
      out.push({
        test: t.name,
        area,
        tightSide: tight,
        note: `${t.name}: højre ${fmt(r)} ${t.unit}, venstre ${fmt(l)} ${t.unit}${tight ? ` → ${SIDE_LABEL[tight]} er strammest og får længere tid` : ' → ingen tydelig forskel'}`,
      });
    } else out.push({ test: t.name, area, note: `${t.name}${t.last?.value != null ? `: ${fmt(t.last.value)} ${t.unit}` : ''} → fokus på ${AREA_SHORT[area]}` });
  }
  return out;
}

// ─── Hvilke dage ────────────────────────────────────────────────────────────

/**
 * `n` dage i ugen til yogaen: så jævnt fordelt som muligt (største mindste afstand, også hen over
 * weekenden) og helst på dage med få andre sessioner. `load` vægter en dags sessioner.
 */
export function pickYogaDays(week: Pick<Week, 'sessions'>, n: number, load: (sessionId: string) => number = () => 1): number[] {
  const count = Math.min(7, Math.max(1, n));
  const dayLoad = (d: number) => week.sessions.filter((s) => s.day === d).reduce((a, s) => a + load(s.sessionId), 0);
  let best: { days: number[]; score: number } | undefined;
  const combos = (start: number, picked: number[]) => {
    if (picked.length === count) {
      const gaps = picked.map((d, i) => (i + 1 < picked.length ? picked[i + 1] - d : picked[0] + 7 - d));
      const score = (count === 1 ? 0 : Math.min(...gaps) * 10) - picked.reduce((a, d) => a + dayLoad(d), 0) * 3;
      if (!best || score > best.score) best = { days: [...picked], score };
      return;
    }
    for (let d = start; d <= 7; d++) combos(d + 1, [...picked, d]);
  };
  combos(1, []);
  return best!.days;
}
