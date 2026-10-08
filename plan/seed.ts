// Læser plan/traeningsplan.xlsx og genererer:
//   plan/plan.v1.json          planen, valideret mod shared/plan.schema.ts
//   plan/seed.sql              planversion 1 + baseline-måling til D1
//   plan/plan.v1.oversigt.md   menneskelæsbar oversigt uge for uge
//
// Kør: npm run plan:build [-- sti/til/ark.xlsx]
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  PlanSchema,
  type Dose,
  type Intensity,
  type NumRange,
  type Plan,
  type PlannedExercise,
  type RunSession,
  type ScheduledSession,
  type SessionSlot,
  type StrengthSession,
  type Week,
  type WeekRange,
} from '../shared/plan.schema';
import { dateOfDay, formatDose, formatIntensity, formatRange, getSession, resolveStrengthSession } from '../shared/resolve';
import {
  ADDUCTOR_FALLBACK,
  ADDUCTOR_REHAB,
  COPENHAGEN_STRENGTH,
  CUSTOM_RUNS,
  EXERCISES,
  MOBILITY_ITEM_IDS,
  NAME_TO_IDS,
  RACE_LABEL_PREFIX,
  REST_LABELS,
  RPE_RULE,
  SIDE_DEFAULTS,
  STRENGTH_LABELS,
  STRENGTH_SHEETS,
} from './seed-config';

const here = path.dirname(fileURLToPath(import.meta.url));

// ─── Celler ─────────────────────────────────────────────────────────────────

type Raw = ExcelJS.CellValue;

function text(v: Raw): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('').trim();
    if ('result' in v) return text(v.result as Raw);
    if ('text' in v) return String(v.text).trim();
    return '';
  }
  return String(v).trim();
}

/** Arket som rækker af tekst (0-indekseret kolonne), plus rå værdier. */
function grid(ws: ExcelJS.Worksheet) {
  const rows: { n: number; cells: string[]; raw: Raw[] }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const raw: Raw[] = [];
    row.eachCell({ includeEmpty: true }, (c, col) => (raw[col - 1] = c.value));
    const cells = Array.from({ length: raw.length }, (_, i) => text(raw[i]));
    if (cells.some(Boolean)) rows.push({ n, cells, raw });
  });
  return rows;
}

const fail = (msg: string): never => {
  throw new Error(msg);
};

// ─── Tekstparsing ───────────────────────────────────────────────────────────

const DASH = '[–-]';
const num = (s: string) => Number(s.replace(',', '.'));

function range(s: string): NumRange {
  const m = s.trim().match(new RegExp(`^(\\d+(?:,\\d+)?)(?:\\s*${DASH}\\s*(\\d+(?:,\\d+)?))?$`));
  if (!m) fail(`Kan ikke læse interval: "${s}"`);
  return { min: num(m![1]), max: num(m![2] ?? m![1]) };
}

function weekRange(s: string): WeekRange {
  const r = range(s);
  return { from: r.min, to: r.max };
}

function restSec(s: string): number {
  const m = s.match(/^(\d+) sek$/);
  return m ? Number(m[1]) : fail(`Kan ikke læse pause: "${s}"`);
}

interface Target {
  sets: number;
  reps?: NumRange;
  seconds?: NumRange;
  perSide?: boolean;
  /** Afvigende dosis pr. side, i arkets rækkefølge. */
  sides?: { side: 'H' | 'V'; sets: number; reps: NumRange }[];
}

/** "3 × 8/ben", "3 × 4–5", "3 × 30 sek/side", "3 × 12 h / 3 × 10 v", "3 × 10 / 3 × 12". */
function parseTargets(raw: string): Target[] {
  const s = raw.replace(/\s*[x×]\s*/g, ' × ').trim();
  const side = s.match(/^(\d+) × (\d+) h \/ (\d+) × (\d+) v$/i);
  if (side) {
    const sides = [
      { side: 'H' as const, sets: +side[1], reps: range(side[2]) },
      { side: 'V' as const, sets: +side[3], reps: range(side[4]) },
    ];
    return [{ sets: Math.max(+side[1], +side[3]), reps: sides[0].reps, perSide: true, sides }];
  }
  return s.split(' / ').map((part) => {
    const m = part.match(new RegExp(`^(\\d+) × (\\d+(?:${DASH}\\d+)?)( sek)?(/ben|/side)?$`));
    if (!m) fail(`Kan ikke læse sæt × reps: "${raw}"`);
    const r = range(m![2]);
    return { sets: +m![1], ...(m![3] ? { seconds: r } : { reps: r }), perSide: !!m![4] };
  });
}

type ParsedIntensity = { rpe?: NumRange; tempo?: string };

function parseIntensity(s: string): ParsedIntensity {
  const m = s.match(new RegExp(`^RPE (\\d+(?:,\\d+)?(?:${DASH}\\d+(?:,\\d+)?)?)$`));
  if (m) return { rpe: range(m[1]) };
  if (/^Se /.test(s) || s === '') return {};
  return { tempo: s };
}

interface Progression {
  weeks: WeekRange;
  sets?: { base: number; optional: number };
  rpe?: NumRange;
  raw: { sets: string; rpe: string; note: string };
}

function parseProgression(cells: string[]): Progression {
  const [w, sets, rpe, note] = cells;
  const s = sets === '—' ? undefined : range(sets);
  return {
    weeks: weekRange(w),
    sets: s && { base: s.min, optional: s.max - s.min },
    rpe: rpe === '—' ? undefined : range(rpe),
    raw: { sets, rpe, note: note ?? '' },
  };
}

function idsFor(name: string): string[] {
  return NAME_TO_IDS[name] ?? fail(`Ukendt øvelsesnavn i arket: "${name}" — tilføj det i seed-config.ts`);
}

const exerciseDef = (id: string) => EXERCISES.find((e) => e.id === id) ?? fail(`Ukendt exercise-id ${id}`);

// ─── Styrkefaner ────────────────────────────────────────────────────────────

interface StrengthRow {
  order: number;
  name: string;
  setsReps: string;
  intensity: string;
  rest: string;
  focus: string;
  rotation?: string;
  cue: string;
}

function readStrengthSheet(ws: ExcelJS.Worksheet) {
  const rows = grid(ws);
  const title = rows[0].cells[0];
  const intro = rows[1].cells[0];
  const hi = rows.findIndex((r) => r.cells[0] === '#');
  const header = rows[hi].cells;
  const col = (name: RegExp) => header.findIndex((h) => name.test(h));
  const c = {
    name: col(/^Øvelse$/),
    sets: col(/^Sæt × reps$/),
    int: col(/^Intensitet$/),
    rest: col(/^Pause$/),
    focus: col(/^Fokusområde$/),
    rot: col(/^Rotation/),
    cue: col(/^Udførelse/),
  };
  const rotationWeeks = c.rot >= 0 ? weekRange(header[c.rot].match(/uge ([\d–-]+)/)![1]) : undefined;

  const exercises: StrengthRow[] = [];
  let i = hi + 1;
  for (; i < rows.length && /^\d+$/.test(rows[i].cells[0]); i++) {
    const r = rows[i].cells;
    exercises.push({
      order: Number(r[0]),
      name: r[c.name],
      setsReps: r[c.sets],
      intensity: r[c.int],
      rest: r[c.rest],
      focus: r[c.focus],
      rotation: c.rot >= 0 ? r[c.rot] : undefined,
      cue: r[c.cue],
    });
  }

  const progression: Progression[] = [];
  const notes: string[] = [];
  const traffic: string[][] = [];
  let section: 'notes' | 'progression' | 'traffic' = 'notes';
  for (; i < rows.length; i++) {
    const r = rows[i].cells;
    if (/^Progression/.test(r[0])) section = 'progression';
    else if (/^Trafiklyset/.test(r[0])) section = 'traffic';
    else if (r[0] === 'Uge' || r[0] === 'Farve') continue;
    else if (section === 'progression' && r.filter(Boolean).length >= 3) progression.push(parseProgression(r));
    else if (section === 'traffic' && r.filter(Boolean).length === 3) traffic.push(r);
    else if (r.filter(Boolean).length === 1) notes.push(r[0]);
    else fail(`${ws.name} række ${rows[i].n}: uventet indhold ${JSON.stringify(r)}`);
  }
  return { title, intro, exercises, progression, notes, traffic, rotationWeeks };
}

/** Én øvelses dosering i én uge. */
function weekDose(
  exerciseId: string,
  target: Target,
  rowIntensity: ParsedIntensity,
  rest: number,
  prog: Progression,
  extra: Partial<Dose> = {},
): Dose {
  const def = exerciseDef(exerciseId);
  if (target.perSide !== undefined && target.perSide !== def.perSide && !target.sides)
    fail(`${exerciseId}: arket siger perSide=${target.perSide}, kataloget ${def.perSide}`);

  // AFKLARING #2: sæt = min(øvelsens sæt, progressionens sæt).
  const cap = (rowSets: number) => {
    const p = prog.sets!;
    const sets = Math.min(rowSets, p.base);
    return { sets, optional: Math.min(rowSets, p.base + p.optional) - sets };
  };
  const { sets, optional } = cap(target.sets);

  // AFKLARING #1: progressionens RPE erstatter øvelsens RPE.
  let intensity: Intensity | undefined;
  if (rowIntensity.rpe) {
    const row = rowIntensity.rpe;
    const p = prog.rpe;
    const r =
      !p || RPE_RULE === 'row'
        ? row
        : RPE_RULE === 'progression'
          ? p
          : { min: Math.min(row.min, p.min), max: Math.min(row.max, p.max) };
    intensity = { kind: 'rpe', ...r };
  }

  const dose: Dose = {
    sets,
    optionalSets: optional,
    ...(target.reps && { reps: target.reps }),
    ...(target.seconds && { seconds: target.seconds }),
    ...(intensity && { intensity }),
    restSec: rest,
    ...(rowIntensity.tempo && { tempo: rowIntensity.tempo }),
    ...(def.perSide && SIDE_DEFAULTS),
    ...extra,
  };
  if (target.sides) {
    const [first, ...rest] = target.sides;
    dose.sideOrder = target.sides.map((s) => s.side) as ['H', 'V'];
    dose.reps = first.reps;
    const overrides: NonNullable<Dose['sideOverrides']> = {};
    for (const s of rest) {
      const c = cap(s.sets);
      overrides[s.side] = { ...(c.sets !== sets && { sets: c.sets }), reps: s.reps };
    }
    dose.sideOverrides = overrides;
  }
  return dose;
}

/** Slår ens varianter sammen og udtrykker deres uger som intervaller. */
function mergeVariants(perWeek: { week: number; exercises: PlannedExercise[] }[]): SessionSlot['variants'] {
  const groups = new Map<string, { weeks: number[]; exercises: PlannedExercise[] }>();
  for (const { week, exercises } of perWeek) {
    const key = JSON.stringify(exercises);
    const g = groups.get(key) ?? { weeks: [], exercises };
    g.weeks.push(week);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ weeks, exercises }) => {
      const ranges: WeekRange[] = [];
      for (const w of weeks.sort((a, b) => a - b)) {
        const last = ranges.at(-1);
        if (last && last.to === w - 1) last.to = w;
        else ranges.push({ from: w, to: w });
      }
      return { weeks: ranges, exercises };
    })
    .sort((a, b) => a.weeks[0].from - b.weeks[0].from);
}

function buildStrengthSession(wb: ExcelJS.Workbook, cfg: (typeof STRENGTH_SHEETS)[number], copenhagenSeconds: Map<number, Pick<Dose, 'seconds' | 'tempo'>>) {
  const sheet = readStrengthSheet(wb.getWorksheet(cfg.sheet) ?? fail(`Mangler fanen ${cfg.sheet}`));
  const weeks = sheet.progression.flatMap((p) =>
    p.sets ? Array.from({ length: p.weeks.to - p.weeks.from + 1 }, (_, i) => ({ week: p.weeks.from + i, prog: p })) : [],
  );
  const inRotation = (w: number) => !!sheet.rotationWeeks && w >= sheet.rotationWeeks.from && w <= sheet.rotationWeeks.to;

  const slots: SessionSlot[] = sheet.exercises.map((row) => {
    const ids = idsFor(row.name);
    const rest = restSec(row.rest);
    const rowInt = parseIntensity(row.intensity);
    const catalogName = (id: string) => exerciseDef(id).name;
    const label = ids.length === 1 && row.name !== catalogName(ids[0]) ? row.name : undefined;
    const cue = row.cue || undefined;

    // Rotationsøvelse: "Navn — dosering[, tempo]" eller bare "Navn" (arver dosering).
    let rotation: { ids: string[]; label?: string; targets: Target[]; tempo?: string } | undefined;
    if (row.rotation && !/^INGEN rotation/.test(row.rotation)) {
      const [name, doseText] = row.rotation.split(' — ');
      const rIds = idsFor(name);
      let targets = parseTargets(row.setsReps); // AFKLARING #7: arver grundøvelsens dosering
      let tempo: string | undefined;
      if (doseText) {
        const [d, ...t] = doseText.split(', ');
        targets = parseTargets(d);
        tempo = t.join(', ') || undefined;
      }
      rotation = { ids: rIds, label: rIds.length === 1 && name !== catalogName(rIds[0]) ? name : undefined, targets, tempo };
    }

    const perWeek = weeks.map(({ week, prog }) => {
      // Rehab A, plads 4: adduktorklem → Copenhagen, uge for uge.
      if (ids[0] === 'adduktorklem') {
        const a = ADDUCTOR_REHAB[week] ?? fail(`Ingen adduktor-dosering for uge ${week}`);
        const pe: PlannedExercise = {
          exerciseId: a.exerciseId,
          label: a.label,
          dose: { sets: a.sets, optionalSets: 0, seconds: { min: a.seconds[0], max: a.seconds[1] }, restSec: rest, ...(a.note && { note: a.note }) },
          ...(cue && { cue }),
          ...(a.alternative && {
            alternative: {
              exerciseId: ADDUCTOR_FALLBACK.exerciseId,
              label: ADDUCTOR_FALLBACK.label,
              condition: ADDUCTOR_FALLBACK.condition,
              dose: {
                sets: ADDUCTOR_FALLBACK.sets,
                optionalSets: 0,
                seconds: { min: ADDUCTOR_FALLBACK.seconds[0], max: ADDUCTOR_FALLBACK.seconds[1] },
                restSec: rest,
              },
            },
          }),
        };
        return { week, exercises: [pe] };
      }

      // Copenhagen plank i Styrke A/B: sekunder og variant efter uge.
      if (ids[0] === 'copenhagen-plank') {
        const cop = copenhagenSeconds.get(week) ?? fail(`Ingen Copenhagen-dosering for uge ${week}`);
        const sameAs = row.setsReps.match(/^(\d+) sæt, samme som/);
        const target: Target = sameAs ? { sets: Number(sameAs[1]) } : parseTargets(row.setsReps)[0];
        const dose = weekDose(ids[0], { ...target, seconds: cop.seconds }, {}, rest, prog, { tempo: cop.tempo });
        return { week, exercises: [{ exerciseId: ids[0], ...(label && { label }), dose, ...(cue && { cue }) }] };
      }

      const useRotation = rotation && inRotation(week);
      const useIds = useRotation ? rotation!.ids : ids;
      const targets = useRotation ? rotation!.targets : parseTargets(row.setsReps);
      // Tempo hører til den konkrete øvelse og arves ikke af rotationsøvelsen.
      const intensity: ParsedIntensity = useRotation ? { rpe: rowInt.rpe, tempo: rotation!.tempo } : rowInt;
      if (targets.length !== useIds.length) fail(`${row.name}: ${useIds.length} øvelser men ${targets.length} doseringer`);
      const exercises = useIds.map((id, k): PlannedExercise => {
        const l = useRotation ? rotation!.label : label;
        return {
          exerciseId: id,
          ...(l && { label: l }),
          dose: weekDose(id, targets[k], intensity, rest, prog),
          ...(!useRotation && cue && { cue }),
        };
      });
      return { week, exercises };
    });

    return { id: `${cfg.id}-${row.order}`, order: row.order, ...(row.focus && { focus: row.focus }), variants: mergeVariants(perWeek) };
  });

  const dur = sheet.intro.match(new RegExp(`^(\\d+${DASH}\\d+) min\\.\\s*(.*)$`));
  const session: StrengthSession = {
    id: cfg.id,
    name: cfg.name,
    kind: 'styrke',
    colorKey: cfg.colorKey,
    suggestedWeekday: cfg.weekday,
    ...(dur && { durationMin: range(dur[1]) }),
    // "Rehab A — hofte og lyske (uge 1–4, mandag)" + "Start med mobilitetsblokken." → "Hofte og lyske. Start med …"
    intro: [sheet.title.split(' — ')[1]?.replace(/\s*\(.*\)$/, ''), dur?.[2] ?? sheet.intro]
      .filter(Boolean)
      .map((s, i) => (i === 0 ? s![0].toUpperCase() + s!.slice(1) + '.' : s))
      .join(' '),
    mobility: 'before',
    slots,
    progression: sheet.progression.map((p) => ({ weeks: p.weeks, ...p.raw })),
    notes: sheet.notes,
  };
  return { session, sheet };
}

// ─── Løb ────────────────────────────────────────────────────────────────────

const codeToId = (code: string) =>
  code
    .toLowerCase()
    .replace('ø', 'o')
    .replace(/\+/g, '-plus')
    .replace(/[^a-z0-9-]/g, '');

function readRunSessions(ws: ExcelJS.Worksheet) {
  const rows = grid(ws);
  const warmup = rows[1].cells[0];
  const hi = rows.findIndex((r) => r.cells[0] === 'Kode');
  const sessions: (RunSession & { optionalInWeek: boolean })[] = [];
  let i = hi + 1;
  for (; i < rows.length && rows[i].cells.filter(Boolean).length >= 5; i++) {
    const [code, type, mainSet, rest, pace, total, purpose] = rows[i].cells;
    const quality = /^(T\d|I-)/.test(code);
    sessions.push({
      id: codeToId(code),
      name: code === 'LØB' ? 'Løb: 5 km' : code,
      kind: code === 'CT' ? 'cardio' : 'løb',
      colorKey: 'run',
      code,
      workoutType: type,
      mainSet,
      ...(rest && rest !== '—' && { rest }),
      ...(pace && { targetPace: pace }),
      ...(total && total !== '—' && { totalApprox: total }),
      ...(purpose && { purpose }),
      ...(quality && { warmup }),
      notes: [],
      optionalInWeek: /valgfri/i.test(type),
    });
  }
  const notes = rows.slice(i).map((r) => r.cells[0]).filter(Boolean);
  return { sessions, notes };
}

// ─── Ugeplan ────────────────────────────────────────────────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function danishDate(s: string): string {
  const m = s.match(/(\d+)\. (\w{3}) (\d{4})/) ?? fail(`Kan ikke læse dato "${s}"`);
  const month = MONTHS.indexOf(m[2]) + 1 || fail(`Ukendt måned "${m[2]}"`);
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function readSchedule(ws: ExcelJS.Worksheet, runs: Map<string, RunSession & { optionalInWeek: boolean }>, startDate: string) {
  const rows = grid(ws);
  const hi = rows.findIndex((r) => r.cells[0] === 'Uge');
  const weeks: Week[] = [];
  const usedCustom = new Set<string>();
  const codes = [...runs.values()].map((r) => r.code!).sort((a, b) => b.length - a.length);
  let skipped: string[] = [];

  for (const row of rows.slice(hi + 1)) {
    const [weekText, dates, phase, ...rest] = row.cells;
    if (!/^\d+$/.test(weekText)) break;
    const weekNo = Number(weekText);
    if (weekNo < 1) {
      skipped.push(`Uge ${weekNo} (${dates}) ligger før planens start og er udeladt.`);
      continue;
    }
    const days = rest.slice(0, 7);
    const [kmLabel, focus] = rest.slice(7);
    const start = new Date(Date.parse(startDate + 'T00:00:00Z') + (weekNo - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
    const firstDay = Number(dates.match(/^(\d+)\./)?.[1]);
    if (firstDay !== Number(start.slice(8, 10))) fail(`Uge ${weekNo}: arket siger "${dates}", beregnet start ${start}`);

    const sessions: ScheduledSession[] = [];
    days.forEach((cell, d) => {
      const day = d + 1;
      if (!cell || REST_LABELS.has(cell)) return;
      if (STRENGTH_LABELS[cell]) return sessions.push({ sessionId: STRENGTH_LABELS[cell], day, label: cell, optional: false });
      if (CUSTOM_RUNS[cell]) {
        const c = CUSTOM_RUNS[cell];
        usedCustom.add(cell);
        return sessions.push({ sessionId: c.id, day, label: cell, optional: false, ...(c.km && { targetKm: { min: c.km[0], max: c.km[1] } }) });
      }
      if (cell.startsWith(RACE_LABEL_PREFIX)) return sessions.push({ sessionId: codeToId('LØB'), day, label: cell, optional: false });

      const code = codes.find((c) => cell === c || cell.startsWith(c + ' '));
      if (!code) fail(`Uge ${weekNo}: ukendt celle "${cell}"`);
      const run = runs.get(codeToId(code!))!;
      const tail = cell.slice(code!.length).trim();
      const [main, condition] = tail.split(' — ');
      const paren = main.match(/\(([^)]*)\)/)?.[1] ?? '';
      const km = paren.match(new RegExp(`^(\\d+(?:${DASH}\\d+)?) km`));
      const min = paren.match(/^(\d+) min$/);
      sessions.push({
        sessionId: run.id,
        day,
        label: cell,
        optional: run.optionalInWeek,
        ...(km && { targetKm: range(km[1]) }),
        ...(min && { targetMin: range(min[1]) }),
        ...(condition && { condition: condition[0].toUpperCase() + condition.slice(1) }),
      });
    });
    weeks.push({ weekNo, startDate: start, phase, ...(focus && { focus }), ...(kmLabel && { kmLabel }), sessions });
  }

  const readingNotes = rows
    .filter((r) => r.cells[0].startsWith('•'))
    .map((r) => r.cells[0].replace(/^•\s*/, ''));
  return { weeks, usedCustom, readingNotes, skipped };
}

// ─── Mobilitet ──────────────────────────────────────────────────────────────

function readMobility(ws: ExcelJS.Worksheet) {
  const rows = grid(ws);
  const dur = rows[1].cells[0].match(new RegExp(`^(\\d+${DASH}\\d+) min\\.\\s*(.*)$`));
  const hi = rows.findIndex((r) => r.cells[0] === '#');
  const items = [];
  let i = hi + 1;
  for (; /^\d+$/.test(rows[i].cells[0]); i++) {
    const [n, name, dose, target, cue] = rows[i].cells;
    const id = MOBILITY_ITEM_IDS[Number(n) - 1] ?? fail(`Mobilitetspunkt ${n} mangler id i seed-config.ts`);
    items.push({ id, name, dose, ...(target && { target }), ...(cue && { cue }) });
  }
  if (items.length !== MOBILITY_ITEM_IDS.length) fail('Antal mobilitetspunkter matcher ikke MOBILITY_ITEM_IDS');

  const mi = rows.findIndex((r) => /^Måling/.test(r.cells[0]));
  const instructions = rows[mi + 1].cells[0].replace(/ Udfyld de gule celler.*$/, '');
  const measurements = rows
    .filter((r) => r.raw[0] instanceof Date)
    .map((r) => ({ date: text(r.raw[0]), right: Number(r.cells[1]), left: Number(r.cells[2]), note: r.cells[4] || null }));
  const notes = rows.filter((r) => r.cells[0].startsWith('•')).map((r) => r.cells[0].replace(/^•\s*/, ''));
  const weeksNote = notes.find((n) => n.startsWith('Måleuger')) ?? fail('Mangler måleuger');
  const measureWeeks = weeksNote.match(/\d+/g)!.map(Number);

  return {
    block: {
      name: rows[0].cells[0].replace(/ — .*$/, ''),
      ...(dur && { durationMin: range(dur[1]) }),
      intro: dur?.[2] ?? rows[1].cells[0],
      items,
      measurement: { instructions, weeks: measureWeeks, reminderDays: 14 },
      notes,
    },
    measurements,
  };
}

// ─── Byg planen ─────────────────────────────────────────────────────────────

/** Læser arket og returnerer en valideret plan. Bruges også af new-version.ts. */
export async function build(xlsxPath: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const sheet = (name: string) => wb.getWorksheet(name) ?? fail(`Mangler fanen ${name}`);

  const ugeplan = grid(sheet('Ugeplan'));
  const title = ugeplan[0].cells[0];
  const [startText, raceText] = title.replace(/^Træningsplan /, '').split(' – ');
  const startDate = danishDate(startText);
  const raceDate = danishDate(raceText);

  const runs = readRunSessions(sheet('Løbeworkouts'));
  const runMap = new Map(runs.sessions.map((r) => [r.id, r]));
  const schedule = readSchedule(sheet('Ugeplan'), runMap, startDate);

  // Copenhagen-sekunder pr. uge (Styrke A-noten gælder også Styrke B).
  const copenhagen = new Map<number, Pick<Dose, 'seconds' | 'tempo'>>();
  for (const c of COPENHAGEN_STRENGTH)
    for (let w = c.weeks.from; w <= c.weeks.to; w++)
      copenhagen.set(w, { seconds: { min: c.seconds[0], max: c.seconds[1] }, tempo: c.tempo });

  const strength = STRENGTH_SHEETS.map((cfg) => buildStrengthSession(wb, cfg, copenhagen));
  const rehabA = strength.find((s) => s.session.id === 'rehab-a')!.sheet;
  const colors = { GRØNT: 'grøn', GULT: 'gul', RØDT: 'rød' } as const;
  const groinRules = rehabA.traffic.map(([c, signal, action]) => ({
    color: colors[c as keyof typeof colors] ?? fail(`Ukendt trafiklysfarve ${c}`),
    signal,
    action,
  }));
  const gate = rehabA.notes.find((n) => n.startsWith('Port til uge 5'));
  const rehabASession = strength.find((s) => s.session.id === 'rehab-a')!.session;
  rehabASession.notes = rehabASession.notes.filter((n) => n !== gate);

  const mobility = readMobility(sheet('Mobilitet'));

  const customSessions: RunSession[] = [...schedule.usedCustom].map((label) => {
    const c = CUSTOM_RUNS[label];
    return { id: c.id, name: c.name, kind: 'løb', colorKey: 'run', workoutType: c.workoutType, mainSet: c.mainSet, notes: [] };
  });

  const plan: Plan = PlanSchema.parse({
    schemaVersion: 1,
    title,
    summary: ugeplan[1].cells[0],
    startDate,
    raceDate,
    readingNotes: schedule.readingNotes,
    exercises: EXERCISES,
    sessions: [
      ...strength.map((s) => s.session),
      ...runs.sessions.map(({ optionalInWeek: _, ...r }) => r),
      ...customSessions,
      {
        id: 'mobilitet',
        name: mobility.block.name,
        kind: 'mobilitet',
        colorKey: 'mobility',
        ...(mobility.block.durationMin && { durationMin: mobility.block.durationMin }),
        notes: [],
      },
    ],
    mobility: mobility.block,
    weeks: schedule.weeks,
    groin: { side: 'V', rules: groinRules, ...(gate && { gate }) },
    runNotes: runs.notes,
  });

  return { plan, measurements: mobility.measurements, skipped: schedule.skipped };
}

// ─── Output ─────────────────────────────────────────────────────────────────

export const sql = (s: string | number | null) => (s === null ? 'NULL' : typeof s === 'number' ? String(s) : `'${s.replace(/'/g, "''")}'`);

/** Fast uuid til baseline-målingen, så seed kan køres flere gange. */
const BASELINE_UUID = '00000000-0000-4000-8000-000000000001';

function seedSql(plan: Plan, measurements: { date: string; right: number; left: number; note: string | null }[]) {
  const now = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
  // Fase 5: alt tilhører atleten "simon", som migration 0006 opretter (med knee-to-wall-testen).
  const athlete = `(SELECT id FROM athletes WHERE slug = 'simon')`;
  const test = `(SELECT id FROM mobility_tests WHERE athlete_id = ${athlete} AND name = 'Knee-to-wall')`;
  const lines = [
    '-- Genereret af plan/seed.ts — rediger ikke i hånden.',
    '-- Indsætter planversion 1 som aktiv for atleten simon, men kun hvis han ingen planversioner har.',
    `INSERT INTO plan_versions (athlete_id, version, created_at, source, note, plan_json, is_active, based_on_version)`,
    `SELECT ${athlete}, 1, ${now}, 'seed', ${sql('Planversion 1 fra traeningsplan.xlsx')}, ${sql(JSON.stringify(plan))}, 1, NULL`,
    `WHERE NOT EXISTS (SELECT 1 FROM plan_versions WHERE athlete_id = ${athlete});`,
    '',
    `UPDATE mobility_tests SET instructions = ${sql(plan.mobility?.measurement?.instructions ?? null)} WHERE id = ${test} AND instructions IS NULL;`,
    '',
  ];
  measurements.forEach((m, i) => {
    const uuid = BASELINE_UUID.slice(0, -1) + String(i + 1);
    lines.push(
      `INSERT INTO mobility_measurements (uuid, athlete_id, test_id, date, value_right, value_left, value, note, updated_at, deleted_at, server_updated_at)`,
      `VALUES (${sql(uuid)}, ${athlete}, ${test}, ${sql(m.date)}, ${m.right}, ${m.left}, NULL, ${sql(m.note)}, ${now}, NULL, ${now})`,
      `ON CONFLICT (uuid) DO NOTHING;`,
    );
  });
  return lines.join('\n') + '\n';
}

const DAYS = ['', 'man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];

/** D1 tillader højst 100 KB pr. SQL-sætning; planen indsættes som én sætning. */
export const MAX_STATEMENT_BYTES = 95_000;

export function assertStatementSize(statement: string) {
  const bytes = Buffer.byteLength(statement, 'utf8');
  if (bytes > MAX_STATEMENT_BYTES)
    throw new Error(`SQL-sætningen er ${bytes} bytes; D1 tillader højst 100 KB. Planen skal gøres mindre eller indsættes via API'et.`);
}

export function overview(plan: Plan, skipped: string[]) {
  const out: string[] = [];
  const p = (s = '') => out.push(s);
  const fmtDate = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;

  p(`# ${plan.title}`);
  p();
  p('> Genereret af `plan/seed.ts` fra `plan/traeningsplan.xlsx`. Rediger ikke i hånden.');
  p();
  p(plan.summary ?? '');
  p();
  skipped.forEach((s) => p(`- ${s}`));
  p();
  p('## Øvelseskatalog');
  p();
  p('| exerciseId | Navn | Type | Unilateral |');
  p('|---|---|---|---|');
  const kind = { weight_reps: 'vægt × reps', bodyweight_reps: 'kropsvægt reps', time: 'tid (sek)' };
  for (const e of plan.exercises) p(`| \`${e.id}\` | ${e.name} | ${kind[e.kind]} | ${e.perSide ? 'ja' : ''} |`);
  p();
  p('## Mobilitetsblok (før alle styrkesessioner)');
  p();
  p('| itemId | Øvelse | Dosering |');
  p('|---|---|---|');
  for (const m of plan.mobility!.items) p(`| \`${m.id}\` | ${m.name} | ${m.dose} |`);
  p();
  p(`Knæ-til-væg måles i uge ${plan.mobility!.measurement!.weeks.join(', ')}; påmindelse efter ${plan.mobility!.measurement!.reminderDays} dage.`);
  p();
  p('## Løbe- og cardiosessioner');
  p();
  p('| sessionId | Kode | Type | Hovedsæt | Pause | Målfart |');
  p('|---|---|---|---|---|---|');
  for (const s of plan.sessions)
    if (s.kind === 'løb' || s.kind === 'cardio')
      p(`| \`${s.id}\` | ${s.code ?? ''} | ${s.workoutType} | ${s.mainSet} | ${s.rest ?? ''} | ${s.targetPace ?? ''} |`);
  p();
  p('## Uge for uge');
  for (const w of plan.weeks) {
    p();
    p(`### Uge ${w.weekNo} · ${fmtDate(w.startDate)}–${fmtDate(dateOfDay(w, 7))} · ${w.phase}`);
    p();
    if (w.focus) p(`_${w.focus}_`);
    p();
    for (const ss of w.sessions) {
      const extra = [
        ss.targetKm && formatRange(ss.targetKm, ' km'),
        ss.targetMin && formatRange(ss.targetMin, ' min'),
        ss.optional && 'valgfri',
        ss.condition,
      ].filter(Boolean);
      p(`- **${DAYS[ss.day]}** ${ss.label} → \`${ss.sessionId}\`${extra.length ? ` (${extra.join(', ')})` : ''}`);
    }
    for (const ss of w.sessions) {
      const s = getSession(plan, ss.sessionId)!;
      if (s.kind !== 'styrke') continue;
      const r = resolveStrengthSession(plan, s.id, w.weekNo);
      p();
      p(`**${s.name}** (uge ${w.weekNo}) — mobilitetsblok først`);
      p();
      p('| # | Øvelse | Dosering | Intensitet | Pause | Tempo / note |');
      p('|---|---|---|---|---|---|');
      for (const slot of r.slots) {
        slot.exercises.forEach((e, k) => {
          const d = e.planned.dose;
          const sideInfo = e.exercise.perSide ? `${d.sideOrder?.[0]} først, ${d.sidePattern === 'block' ? 'blokvis' : 'skiftevis'}` : '';
          const notes = [d.tempo, d.note, sideInfo].filter(Boolean).join('; ');
          const name = `${e.label}${slot.superset ? ` (superset ${k + 1}/2)` : ''} \`${e.exercise.id}\``;
          p(`| ${k === 0 ? slot.order : ''} | ${name} | ${formatDose(e.exercise, d)} | ${formatIntensity(d)} | ${d.restSec} s | ${notes} |`);
          const alt = e.planned.alternative;
          if (alt) {
            const altEx = plan.exercises.find((x) => x.id === alt.exerciseId)!;
            p(`| | ↳ alternativ: ${alt.label ?? altEx.name} \`${altEx.id}\` | ${formatDose(altEx, alt.dose)} | | ${alt.dose.restSec} s | ${alt.condition} |`);
          }
        });
      }
    }
  }
  return out.join('\n') + '\n';
}

// Kør kun når scriptet startes direkte (ikke når new-version.ts importerer build).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const xlsxPath = process.argv[2] ?? path.join(here, 'traeningsplan.xlsx');
  const { plan, measurements, skipped } = await build(xlsxPath);
  const json = JSON.stringify(plan, null, 2) + '\n';
  const seed = seedSql(plan, measurements);
  assertStatementSize(seed.split(';\n')[0]);
  writeFileSync(path.join(here, 'plan.v1.json'), json);
  writeFileSync(path.join(here, 'seed.sql'), seed);
  writeFileSync(path.join(here, 'plan.v1.oversigt.md'), overview(plan, skipped));

  const strengthSessions = plan.sessions.filter((s) => s.kind === 'styrke');
  console.log(
    `Plan: ${plan.weeks.length} uger (${plan.startDate} → ${plan.raceDate}), ${plan.exercises.length} øvelser, ` +
      `${strengthSessions.length} styrkesessioner, ${plan.sessions.length - strengthSessions.length - 1} løb/cardio, ` +
      `${plan.mobility!.items.length} mobilitetspunkter. JSON: ${(Buffer.byteLength(JSON.stringify(plan)) / 1024).toFixed(1)} KB minificeret.`,
  );
}
