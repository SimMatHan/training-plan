// Redigering af en styrkesession i appen. Atleten ser sessionen, som den er i én uge, retter
// i den (dosering, byt, tilføj, fjern, rækkefølge) og vælger hvilke uger det gælder. Ændringerne
// lægges ind i planens pladser og varianter, så resten af planen (fx progression i senere uger)
// er urørt:
//  - en rettet dosering ændrer kun de felter der blev rettet, i varianterne i ugerne hvor samme
//    øvelse står på pladsen, og kun hvor feltet havde samme værdi (deload og progression bevares)
//  - en byttet øvelse byttes de samme steder
//  - en fjernet plads fjernes i ugerne; en ny plads tilføjes i ugerne
//  - ændres antallet af øvelser på en plads (superset), erstattes øvelserne i ugerne hvor
//    pladsen havde de samme øvelser
//  - rækkefølgen gælder alle uger (pladsernes order er fælles)
// Resultatet er en plan, der skal valideres (PlanSchema og id-reglerne) før den gemmes.
import type { Dose, Exercise, ExerciseKind, Plan, PlannedExercise, SessionSlot, SlotVariant, StrengthSession, WeekRange } from './plan.schema';
import { resolveStrengthSession } from './resolve';

/** Ugerne en redigering gælder: [from, to]. */
export type EditScope = { from: number; to: number };

/** En plads i redigeringen, som den skal se ud i den viste uge. */
export interface DraftSlot {
  /** Pladsens id, eller null for en ny plads. */
  slotId: string | null;
  exercises: PlannedExercise[];
}

const clone = <T>(v: T): T => structuredClone(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Sidste uge planen eller nogen variant dækker. */
export function lastWeek(plan: Plan): number {
  let max = Math.max(...plan.weeks.map((w) => w.weekNo));
  for (const s of plan.sessions)
    if (s.kind === 'styrke') for (const slot of s.slots) for (const v of slot.variants) for (const r of v.weeks) max = Math.max(max, r.to);
  return max;
}

export type ScopeKind = 'uge' | 'frem' | 'alle';

export function scopeFor(plan: Plan, weekNo: number, kind: ScopeKind): EditScope {
  if (kind === 'uge') return { from: weekNo, to: weekNo };
  return { from: kind === 'alle' ? 1 : weekNo, to: lastWeek(plan) };
}

// ─── Ugeintervaller ─────────────────────────────────────────────────────────

function intersect(weeks: WeekRange[], scope: EditScope): WeekRange[] {
  return weeks
    .map((r) => ({ from: Math.max(r.from, scope.from), to: Math.min(r.to, scope.to) }))
    .filter((r) => r.from <= r.to);
}

function subtract(weeks: WeekRange[], scope: EditScope): WeekRange[] {
  return weeks.flatMap((r) => {
    const out: WeekRange[] = [];
    if (r.from < scope.from) out.push({ from: r.from, to: Math.min(r.to, scope.from - 1) });
    if (r.to > scope.to) out.push({ from: Math.max(r.from, scope.to + 1), to: r.to });
    return out;
  });
}

/**
 * Deler pladsens varianter ved scopets grænser og kalder `edit` på delen inden for scopet.
 * Varianter helt uden for scopet røres ikke.
 */
function editInScope(slot: SessionSlot, scope: EditScope, edit: (v: SlotVariant) => void) {
  const variants: SlotVariant[] = [];
  for (const v of slot.variants) {
    const inside = intersect(v.weeks, scope);
    if (!inside.length) {
      variants.push(v);
      continue;
    }
    const outside = subtract(v.weeks, scope);
    if (outside.length) variants.push({ ...clone(v), weeks: outside });
    const edited = { ...clone(v), weeks: inside };
    edit(edited);
    variants.push(edited);
  }
  slot.variants = variants;
}

/** Fjerner pladsens dækning i scopet. Varianter (og pladsen) uden uger tilbage forsvinder. */
function clearScope(session: StrengthSession, slotId: string, scope: EditScope) {
  const slot = session.slots.find((s) => s.id === slotId);
  if (!slot) return;
  slot.variants = slot.variants.map((v) => ({ ...v, weeks: subtract(v.weeks, scope) })).filter((v) => v.weeks.length);
  if (!slot.variants.length) session.slots = session.slots.filter((s) => s !== slot);
}

// ─── Øvelser ────────────────────────────────────────────────────────────────

const SIDE_FIELDS = ['sideOrder', 'sidePattern', 'sideOverrides'] as const;

/**
 * Lægger de felter fra `edited` der afviger fra `original` ind i `target` (manglende felter
 * fjernes), men kun hvor `target` havde samme værdi som `original`. Så beholder uger med en anden
 * dosering i planen (deload, progression) deres egen.
 */
function applyFieldChanges<T extends object>(target: T, original: T, edited: T, skip: string[] = []) {
  const t = target as Record<string, unknown>;
  const o = original as Record<string, unknown>;
  const e = edited as Record<string, unknown>;
  for (const key of new Set([...Object.keys(o), ...Object.keys(e)])) {
    if (skip.includes(key) || same(o[key], e[key]) || !same(t[key], o[key])) continue;
    if (e[key] === undefined) delete t[key];
    else t[key] = clone(e[key]);
  }
}

/** Fjerner sidefelter fra en dosering til en øvelse der ikke er sidevis, og tidsfelter/repsfelter der ikke passer til typen. */
function fitDose(dose: Dose, exercise: Exercise | undefined) {
  if (!exercise) return;
  if (!exercise.perSide) for (const f of SIDE_FIELDS) delete dose[f];
  if (exercise.kind === 'time') delete dose.reps;
  else delete dose.seconds;
}

function fitPlanned(pe: PlannedExercise, catalog: Exercise[]) {
  fitDose(pe.dose, catalog.find((e) => e.id === pe.exerciseId));
  if (pe.alternative) fitDose(pe.alternative.dose, catalog.find((e) => e.id === pe.alternative!.exerciseId));
}

/** Ændringerne fra én planlagt øvelse til en anden, lagt ind i `target`. */
function applyExerciseChange(target: PlannedExercise, original: PlannedExercise, edited: PlannedExercise) {
  applyFieldChanges(target, original, edited, ['dose']);
  applyFieldChanges(target.dose, original.dose, edited.dose);
}

// ─── Redigeringen ───────────────────────────────────────────────────────────

/** Sessionens pladser som de ser ud i ugen: udgangspunktet for redigeringen. */
export function draftFor(plan: Plan, sessionId: string, weekNo: number): DraftSlot[] {
  return resolveStrengthSession(plan, sessionId, weekNo).slots.map((s) => ({ slotId: s.slotId, exercises: s.exercises.map((e) => clone(e.planned)) }));
}

function newSlotId(session: StrengthSession, taken: Set<string>): string {
  for (let n = session.slots.length + 1; ; n++) {
    const id = `${session.id}-${n}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

/**
 * Lægger redigeringen af sessionen (set i `weekNo`) ind i planen for ugerne i `scope`.
 * `plan.exercises` skal allerede indeholde nye øvelser.
 */
export function applySessionEdit(plan: Plan, sessionId: string, weekNo: number, scope: EditScope, drafts: DraftSlot[]): Plan {
  const result = clone(plan);
  const session = result.sessions.find((s) => s.id === sessionId);
  if (!session || session.kind !== 'styrke') throw new Error(`Ingen styrkesession med id ${sessionId}`);
  const before = draftFor(plan, sessionId, weekNo);
  const visible = new Set(before.map((d) => d.slotId!));
  const kept = new Set(drafts.map((d) => d.slotId).filter((id): id is string => !!id));
  const taken = new Set(session.slots.map((s) => s.id));

  // Fjernede pladser.
  for (const id of visible) if (!kept.has(id)) clearScope(session, id, scope);

  // Rettede pladser.
  for (const draft of drafts) {
    if (!draft.slotId) continue;
    const original = before.find((b) => b.slotId === draft.slotId)?.exercises;
    const slot = session.slots.find((s) => s.id === draft.slotId);
    if (!original || !slot || same(original, draft.exercises)) continue;
    if (original.length !== draft.exercises.length) {
      // Superset ændret: øvelserne erstattes i ugerne, hvor pladsen havde de samme øvelser.
      const ids = original.map((o) => o.exerciseId);
      editInScope(slot, scope, (v) => {
        if (!same(v.exercises.map((e) => e.exerciseId), ids)) return;
        v.exercises = clone(draft.exercises);
        v.exercises.forEach((pe) => fitPlanned(pe, result.exercises));
      });
      continue;
    }
    editInScope(slot, scope, (v) => {
      if (v.exercises.length !== original.length) return;
      original.forEach((o, i) => {
        const edited = draft.exercises[i];
        if (same(o, edited) || v.exercises[i].exerciseId !== o.exerciseId) return;
        applyExerciseChange(v.exercises[i], o, edited);
        if (edited.exerciseId !== o.exerciseId) fitPlanned(v.exercises[i], result.exercises);
      });
    });
  }

  // Nye pladser får ugerne i scopet.
  const created = new Map<DraftSlot, SessionSlot>();
  for (const draft of drafts) {
    if (draft.slotId) continue;
    const exercises = clone(draft.exercises);
    exercises.forEach((pe) => fitPlanned(pe, result.exercises));
    const slot: SessionSlot = { id: newSlotId(session, taken), order: 0, variants: [{ weeks: [{ ...scope }], exercises }] };
    session.slots.push(slot);
    created.set(draft, slot);
  }

  // Rækkefølge: de viste pladser i redigeringens rækkefølge, på de pladser de havde; skjulte
  // pladser (ikke aktive i ugen) bliver hvor de er; nye sættes ind efter deres forgænger.
  const fresh = new Set(created.values());
  const sorted = session.slots.filter((s) => !fresh.has(s)).sort((a, b) => a.order - b.order);
  const existingInDraft = drafts.filter((d) => d.slotId && session.slots.some((s) => s.id === d.slotId)).map((d) => session.slots.find((s) => s.id === d.slotId)!);
  const draftSet = new Set(existingInDraft);
  const queue = [...existingInDraft];
  const ordered: SessionSlot[] = sorted.map((s) => (draftSet.has(s) ? queue.shift()! : s));
  drafts.forEach((d, i) => {
    const slot = created.get(d);
    if (!slot) return;
    const prev = drafts.slice(0, i).reverse().map((p) => (p.slotId ? session.slots.find((s) => s.id === p.slotId) : created.get(p))).find(Boolean);
    const next = drafts.slice(i + 1).map((p) => (p.slotId ? session.slots.find((s) => s.id === p.slotId) : undefined)).find(Boolean);
    if (prev && ordered.includes(prev)) ordered.splice(ordered.indexOf(prev) + 1, 0, slot);
    else if (next && ordered.includes(next)) ordered.splice(ordered.indexOf(next), 0, slot);
    else ordered.push(slot);
  });
  ordered.forEach((s, i) => (s.order = i + 1));
  session.slots = ordered;
  return result;
}

// ─── Katalog ────────────────────────────────────────────────────────────────

/** "Hip thrust på bænk" → "hip-thrust-paa-baenk". */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return s || 'oevelse';
}

/** Et nyt id til en øvelse, der ikke er brugt (i planen eller i loggen). */
export function newExerciseId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(name);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Doseringen øvelsen har andre steder i planen, ellers et udgangspunkt efter typen. */
export function defaultDose(plan: Plan, exercise: Pick<Exercise, 'id' | 'kind'>): Dose {
  for (const s of plan.sessions)
    if (s.kind === 'styrke')
      for (const slot of s.slots)
        for (const v of slot.variants)
          for (const pe of v.exercises) if (pe.exerciseId === exercise.id) return clone(pe.dose);
  return exercise.kind === 'time'
    ? { sets: 3, optionalSets: 0, seconds: { min: 30, max: 30 }, restSec: 60 }
    : { sets: 3, optionalSets: 0, reps: { min: 8, max: 8 }, restSec: 90 };
}

export const KIND_LABEL: Record<ExerciseKind, string> = { weight_reps: 'Vægt og reps', bodyweight_reps: 'Kropsvægt', time: 'Tid' };
