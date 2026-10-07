// Læsbar forskel mellem to planversioner, fx
//   "Styrke A · Enbens RDL, uge 5–8: 3 × 8/side, RPE 6 → 3 × 10/side, RPE 6".
// Bruges til Claudes forslag (MCP-svaret og forslagsvisningen i appen).
import type { Plan, Session, StrengthSession } from './plan.schema';
import { formatDose, formatIntensity, getExercise, resolveStrengthSession } from './resolve';

const DAYS = ['', 'man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];

/** [5, 6, 7, 8, 11] → "5–8, 11". */
export function formatWeekList(weeks: number[]): string {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** Samler ens tekster på tværs af uger: [{5,"x"},{6,"x"}] → "uge 5–6: x". */
function byWeeks(entries: { week: number; key: string; text: string }[]): string[] {
  const groups = new Map<string, { text: string; weeks: number[] }>();
  for (const e of entries) {
    const g = groups.get(e.key) ?? { text: e.text, weeks: [] };
    g.weeks.push(e.week);
    groups.set(e.key, g);
  }
  return [...groups.values()].map((g) => g.text.replace('{uger}', `uge ${formatWeekList(g.weeks)}`));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const quote = (s: string | undefined) => (s ? `"${s.length > 80 ? s.slice(0, 77) + '…' : s}"` : '(tom)');

function doseText(plan: Plan, exerciseId: string, dose: Parameters<typeof formatDose>[1]): string {
  const ex = getExercise(plan, exerciseId);
  if (!ex) return '?';
  return [formatDose(ex, dose), formatIntensity(dose), `pause ${dose.restSec} s`, dose.tempo, dose.note].filter(Boolean).join(', ');
}

/** Øvelse → dosering for en styrkesession i en uge. Tom hvis sessionen ikke kan udledes. */
function strengthDoses(plan: Plan, sessionId: string, weekNo: number): Map<string, string> {
  const out = new Map<string, string>();
  try {
    for (const slot of resolveStrengthSession(plan, sessionId, weekNo).slots)
      for (const e of slot.exercises) {
        out.set(e.exercise.id, doseText(plan, e.exercise.id, e.planned.dose));
        const alt = e.planned.alternative;
        if (alt) out.set(`${alt.exerciseId} (alternativ)`, doseText(plan, alt.exerciseId, alt.dose));
      }
  } catch {
    // Sessionen findes ikke (længere) i planen.
  }
  return out;
}

const scheduledWeeks = (plan: Plan, sessionId: string) =>
  plan.weeks.filter((w) => w.sessions.some((s) => s.sessionId === sessionId)).map((w) => w.weekNo);

const exerciseName = (before: Plan, after: Plan, key: string) => {
  const [id, suffix] = key.split(' ');
  const name = getExercise(after, id)?.name ?? getExercise(before, id)?.name ?? id;
  return suffix ? `${name} ${suffix}` : name;
};

function diffStrength(before: Plan, after: Plan, b: StrengthSession | undefined, a: StrengthSession): string[] {
  const lines: string[] = [];
  const weeks = [...new Set([...scheduledWeeks(before, a.id), ...scheduledWeeks(after, a.id)])].sort((x, y) => x - y);
  const entries: { week: number; key: string; text: string }[] = [];
  for (const week of weeks) {
    const was = b ? strengthDoses(before, a.id, week) : new Map<string, string>();
    const now = strengthDoses(after, a.id, week);
    for (const key of new Set([...was.keys(), ...now.keys()])) {
      const x = was.get(key);
      const y = now.get(key);
      if (x === y) continue;
      const name = exerciseName(before, after, key);
      const change = x === undefined ? `tilføjet: ${y}` : y === undefined ? `fjernet (var ${x})` : `${x} → ${y}`;
      entries.push({ week, key: `${key}|${x}|${y}`, text: `${a.name} · ${name}, {uger}: ${change}` });
    }
  }
  lines.push(...byWeeks(entries));
  if (b) {
    if (b.name !== a.name) lines.push(`${b.name}: omdøbt til ${a.name}`);
    if (!same(b.notes, a.notes) || b.intro !== a.intro) lines.push(`${a.name}: noter ændret`);
    if (!same(b.progression, a.progression)) lines.push(`${a.name}: progressionstabel ændret`);
    if (b.mobility !== a.mobility) lines.push(`${a.name}: mobilitet ${b.mobility} → ${a.mobility}`);
    if (!lines.length && !same(b, a)) lines.push(`${a.name}: øvelsernes udførelse eller rækkefølge ændret`);
  }
  return lines;
}

const RUN_FIELDS = [
  ['workoutType', 'type'],
  ['mainSet', 'hovedsæt'],
  ['rest', 'pause'],
  ['targetPace', 'tempo'],
  ['totalApprox', 'total'],
  ['purpose', 'formål'],
  ['warmup', 'opvarmning'],
  ['code', 'kode'],
] as const;

function diffSession(before: Plan, after: Plan, b: Session | undefined, a: Session | undefined): string[] {
  if (!a) return b ? [`Session fjernet: ${b.name}`] : [];
  if (a.kind === 'styrke') {
    const prev = b?.kind === 'styrke' ? b : undefined;
    return [...(b ? [] : [`Ny session: ${a.name}`]), ...diffStrength(before, after, prev, a)];
  }
  if (!b) return [`Ny session: ${a.name}`];
  const lines: string[] = [];
  if (b.name !== a.name) lines.push(`${b.name}: omdøbt til ${a.name}`);
  if (a.kind !== 'mobilitet' && b.kind !== 'mobilitet' && b.kind !== 'styrke')
    for (const [field, label] of RUN_FIELDS)
      if (b[field] !== a[field]) lines.push(`${a.name}: ${label} ${quote(b[field])} → ${quote(a[field])}`);
  if (!same(b.notes, a.notes)) lines.push(`${a.name}: noter ændret`);
  if (!lines.length && !same(b, a)) lines.push(`${a.name}: ændret`);
  return lines;
}

function diffWeeks(before: Plan, after: Plan): string[] {
  const lines: string[] = [];
  const entries: { week: number; key: string; text: string }[] = [];
  const name = (id: string) => after.sessions.find((s) => s.id === id)?.name ?? before.sessions.find((s) => s.id === id)?.name ?? id;
  const range = (r?: { min: number; max: number }) => (r ? (r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`) : '–');
  for (const weekNo of [...new Set([...before.weeks, ...after.weeks].map((w) => w.weekNo))].sort((x, y) => x - y)) {
    const b = before.weeks.find((w) => w.weekNo === weekNo);
    const a = after.weeks.find((w) => w.weekNo === weekNo);
    if (!a) {
      lines.push(`Uge ${weekNo} fjernet`);
      continue;
    }
    if (!b) {
      lines.push(`Ny uge ${weekNo} (${a.phase})`);
      continue;
    }
    const push = (key: string, text: string) => entries.push({ week: weekNo, key, text: `{uger}: ${text}` });
    if (b.phase !== a.phase) push(`phase|${b.phase}|${a.phase}`, `fase ${quote(b.phase)} → ${quote(a.phase)}`);
    if (b.focus !== a.focus) push(`focus|${a.focus}`, `fokus ${quote(a.focus)}`);
    if (b.kmLabel !== a.kmLabel) push(`km|${b.kmLabel}|${a.kmLabel}`, `km ${b.kmLabel ?? '–'} → ${a.kmLabel ?? '–'}`);
    if (b.startDate !== a.startDate) push(`start|${a.startDate}`, `startdato ${b.startDate} → ${a.startDate}`);
    for (const s of a.sessions) {
      const old = b.sessions.find((x) => x.sessionId === s.sessionId);
      if (!old) {
        push(`+${s.sessionId}|${s.day}|${s.label}`, `+ ${name(s.sessionId)} (${DAYS[s.day]}${s.optional ? ', valgfri' : ''}) ${quote(s.label)}`);
        continue;
      }
      if (old.day !== s.day) push(`day|${s.sessionId}|${old.day}|${s.day}`, `${name(s.sessionId)} ${DAYS[old.day]} → ${DAYS[s.day]}`);
      if (old.label !== s.label) push(`label|${s.sessionId}|${s.label}`, `${name(s.sessionId)}: ${quote(old.label)} → ${quote(s.label)}`);
      if (!same(old.targetKm, s.targetKm)) push(`km|${s.sessionId}|${range(old.targetKm)}|${range(s.targetKm)}`, `${name(s.sessionId)} km ${range(old.targetKm)} → ${range(s.targetKm)}`);
      if (!same(old.targetMin, s.targetMin)) push(`min|${s.sessionId}|${range(old.targetMin)}|${range(s.targetMin)}`, `${name(s.sessionId)} min ${range(old.targetMin)} → ${range(s.targetMin)}`);
      if (old.optional !== s.optional) push(`opt|${s.sessionId}|${s.optional}`, `${name(s.sessionId)} ${s.optional ? 'nu valgfri' : 'ikke længere valgfri'}`);
      if (old.condition !== s.condition) push(`cond|${s.sessionId}|${s.condition}`, `${name(s.sessionId)} betingelse ${quote(s.condition)}`);
    }
    for (const s of b.sessions)
      if (!a.sessions.some((x) => x.sessionId === s.sessionId)) push(`-${s.sessionId}`, `− ${name(s.sessionId)} (${DAYS[s.day]})`);
  }
  return [...lines, ...byWeeks(entries).map((l) => l.charAt(0).toUpperCase() + l.slice(1))];
}

/** Ændringerne fra `before` til `after` som korte danske linjer. */
export function describePlanChange(before: Plan, after: Plan): string[] {
  const lines: string[] = [];
  for (const e of after.exercises) {
    const old = before.exercises.find((x) => x.id === e.id);
    if (!old) lines.push(`Ny øvelse: ${e.name} (${e.id})`);
    else if (!same(old, e)) lines.push(`Øvelse ${e.name}: beskrivelse ændret`);
  }
  const sessionIds = [...new Set([...before.sessions, ...after.sessions].map((s) => s.id))];
  for (const id of sessionIds)
    lines.push(...diffSession(before, after, before.sessions.find((s) => s.id === id), after.sessions.find((s) => s.id === id)));
  lines.push(...diffWeeks(before, after));

  const top: [keyof Plan, string][] = [
    ['title', 'Titel'],
    ['summary', 'Resumé'],
    ['startDate', 'Startdato'],
    ['raceDate', 'Løbsdato'],
    ['goals', 'Mål'],
    ['readingNotes', 'Læsevejledning'],
    ['runNotes', 'Løbenoter'],
    ['groin', 'Lyskeregler'],
    ['mobility', 'Mobilitetsblokken'],
  ];
  for (const [key, label] of top) if (!same(before[key], after[key])) lines.push(`${label} ændret`);
  return lines.length ? lines : ['Ingen ændringer i planens indhold'];
}
