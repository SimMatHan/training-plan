// MCP-værktøjerne. Tynde lag over worker/services: hvert værktøj validerer input med zod,
// kalder services og formaterer et kompakt JSON-svar med danske feltnavne og datoer som
// YYYY-MM-DD. Ingen SQL her. Alt input behandles som utroværdigt.
//
// Ingen værktøjer sletter, aktiverer planversioner eller ændrer logs; det gøres i appen.
import { z, ZodError } from 'zod';
import { measurementDue } from '../../shared/mobility';
import { formatDuration, formatPace } from '../../shared/pace';
import { IsoDate, Slug, type Dose, type Plan, type Session, type WeekRange } from '../../shared/plan.schema';
import { formatWeekList } from '../../shared/planDiff';
import { readyForMoreWeight, findPlannedDose } from '../../shared/progression';
import type { Workout } from '../../shared/records.schema';
import { dateOfDay, formatDose, formatIntensity, getExercise, getSession, weekForDate } from '../../shared/resolve';
import { getAt, JsonPatch, PatchError } from '../../shared/jsonPatch';
import { recordMcpCall, type McpErrorKind } from '../services/audit';
import { addDays, todayInCopenhagen } from '../services/clock';
import { NotFoundError, ValidationError } from '../services/errors';
import { getExerciseHistory, getWeeklySummary } from '../services/history';
import { listCoachNotes, createCoachNote } from '../services/notes';
import { getActivePlan, getPlanVersion, getWeek } from '../services/plan';
import { createProposal, listProposals, MAX_PATCH_BYTES } from '../services/proposals';
import { getGroinTrend, getMobilityTrend } from '../services/trends';
import { listWorkouts, logRun } from '../services/workouts';

const DAG = ['', 'man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];
const UGEDAG = ['', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
const KIND = { weight_reps: 'vægt', bodyweight_reps: 'kropsvægt', time: 'tid' } as const;

const weekdayOf = (date: string) => ((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;
const weeksText = (ranges: WeekRange[]) => formatWeekList(ranges.flatMap((r) => Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i)));

/** Fjerner null, undefined og tomme lister, så svarene er kompakte. */
function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(compact) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => [k, compact(v)]),
    ) as T;
  return value;
}

function doseText(plan: Plan, exerciseId: string, dose: Dose) {
  const ex = getExercise(plan, exerciseId);
  return ex ? [formatDose(ex, dose), formatIntensity(dose), `pause ${dose.restSec} s`].filter(Boolean).join(', ') : '?';
}

function runOut(w: Workout, plan: Plan) {
  return {
    id: w.uuid,
    dato: w.date,
    uge: w.week_no,
    session: w.planned_session_id ? (getSession(plan, w.planned_session_id)?.name ?? w.planned_session_id) : 'uden for planen',
    distanceKm: w.distance_km,
    tid: w.duration_sec ? formatDuration(w.duration_sec) : null,
    tempo: formatPace(w.duration_sec, w.distance_km) ? `${formatPace(w.duration_sec, w.distance_km)}/km` : null,
    puls: w.avg_hr,
    rpe: w.rpe,
    lyske: w.groin_during,
    note: w.note,
    ...(w.source !== 'app' && { kilde: w.source }),
    ...(w.skipped_at && { sprungetOver: w.skip_reason ?? true }),
  };
}

/** "45:30" eller "1:02:03" → sekunder. */
function parseTid(tid: string): number {
  const m = tid.trim().match(/^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)$/);
  if (!m) throw new ValidationError('tid skal være mm:ss eller t:mm:ss, fx "45:30" eller "1:02:03"');
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// ─── Værktøjer ──────────────────────────────────────────────────────────────

export interface ToolContext {
  db: D1Database;
  now: Date;
}

export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: S;
  readOnly: boolean;
  run: (ctx: ToolContext, input: z.output<S>) => Promise<unknown>;
}

const tool = <S extends z.ZodObject>(def: ToolDef<S>) => def as unknown as ToolDef;

const Uge = z.int().min(1).max(60);
const Tekst = (max: number) => z.string().trim().min(1).max(max);

export const TOOLS: ToolDef[] = [
  tool({
    name: 'hent_status',
    title: 'Status lige nu',
    description:
      'Overblik lige nu: dags dato, hvilken uge af planen og fase, dagens og ugens sessioner med status, trafiklys for lysken de sidste 7 dage, ' +
      'dage siden sidste knee-to-wall-måling, ventende planforslag og åbne noter. Brug det først i en samtale om træningen.',
    input: z.object({}),
    readOnly: true,
    async run({ db, now }) {
      const today = todayInCopenhagen(now);
      const { meta, plan } = await getActivePlan(db);
      const week = weekForDate(plan, today);
      const [lights, mobility, proposals, notes] = await Promise.all([
        getGroinTrend(db, addDays(today, -6), today),
        getMobilityTrend(db),
        listProposals(db, { status: 'afventer' }),
        listCoachNotes(db),
      ]);
      let uge: unknown = null;
      if (week) {
        const summary = await getWeeklySummary(db, week.weekNo, today);
        const sessions = summary.sessions.map((s) => ({
          sessionId: s.sessionId,
          navn: s.name,
          dag: DAG[s.day],
          dato: dateOfDay(week, s.day),
          status: s.status,
          årsag: s.skipReason,
          lys: s.light,
          valgfri: s.optional || null,
        }));
        uge = {
          nr: week.weekNo,
          afUger: plan.weeks.length,
          fase: week.phase,
          fokus: week.focus,
          km: week.kmLabel,
          lavet: `${summary.done}/${summary.planned}`,
          iDag: sessions.filter((s) => s.dato === today),
          sessioner: sessions,
        };
      }
      const due = measurementDue(mobility, today, plan.mobility.measurement.reminderDays);
      return {
        dato: today,
        ugedag: UGEDAG[weekdayOf(today)],
        planversion: meta.version,
        planStart: plan.startDate,
        løbsdato: plan.raceDate,
        uge: uge ?? (today < plan.startDate ? 'planen er ikke startet' : 'planen er slut'),
        lyskeSeneste7Dage: lights.map((l) => ({ dato: l.date, under: l.during, morgen: l.morning, lys: l.light })),
        kneeToWall: { dageSidenSidste: due.days, påmindelseEfterDage: plan.mobility.measurement.reminderDays, skalMåles: due.due },
        ventendeForslag: proposals.map((p) => ({ id: p.id, summary: p.summary, oprettet: p.createdAt.slice(0, 10) })),
        åbneNoter: notes.length,
      };
    },
  }),

  tool({
    name: 'hent_plan',
    title: 'Planen',
    description:
      'Den aktive planversion (eller en angivet version) i kompakt form: sessioner, øvelser og dosering pr. ugeinterval, ugeprogrammet, ' +
      'mobilitet og lyskeregler. Hver variant og uge har en "sti" (JSON Pointer). Angiv "sti" for at få den rå JSON under stien, ' +
      'fx "/sessions/2/slots/1" — brug det, når du skal skrive en patch til foreslaa_planaendring.',
    input: z.object({
      version: z.int().min(1).optional().describe('Planversion. Udelades for den aktive.'),
      sti: z.string().max(300).optional().describe('JSON Pointer ind i planen, fx "/weeks/4". Giver rå JSON for netop den del.'),
    }),
    readOnly: true,
    async run({ db }, { version, sti }) {
      const { meta, plan } = version ? await getPlanVersion(db, version) : await getActivePlan(db);
      if (sti !== undefined) {
        try {
          return { version: meta.version, sti, json: getAt(plan, sti) };
        } catch (e) {
          if (e instanceof PatchError) throw new NotFoundError(e.message);
          throw e;
        }
      }
      return {
        version: meta.version,
        aktiv: meta.is_active,
        kilde: meta.source,
        note: meta.note,
        titel: plan.title,
        start: plan.startDate,
        løbsdato: plan.raceDate,
        sessioner: plan.sessions.map((s: Session, si) => {
          const base = { id: s.id, navn: s.name, type: s.kind, sti: `/sessions/${si}` };
          if (s.kind === 'styrke')
            return {
              ...base,
              mobilitet: s.mobility,
              pladser: s.slots.map((slot, sli) => ({
                id: slot.id,
                fokus: slot.focus,
                varianter: slot.variants.map((v, vi) => ({
                  uger: weeksText(v.weeks),
                  sti: `/sessions/${si}/slots/${sli}/variants/${vi}`,
                  øvelser: v.exercises.map((pe) => ({
                    exerciseId: pe.exerciseId,
                    navn: pe.label ?? getExercise(plan, pe.exerciseId)?.name,
                    dosering: doseText(plan, pe.exerciseId, pe.dose),
                    tempo: pe.dose.tempo,
                    note: pe.dose.note,
                    alternativ: pe.alternative && `${pe.alternative.exerciseId}: ${pe.alternative.condition}`,
                  })),
                })),
              })),
              progression: s.progression.map((p) => `uge ${weeksText([p.weeks])}: ${p.sets} sæt, RPE ${p.rpe}${p.note ? ` (${p.note})` : ''}`),
            };
          if (s.kind === 'mobilitet') return base;
          return { ...base, kode: s.code, hovedsæt: s.mainSet, tempo: s.targetPace, total: s.totalApprox, formål: s.purpose };
        }),
        uger: plan.weeks.map((w, wi) => ({
          uge: w.weekNo,
          start: w.startDate,
          fase: w.phase,
          fokus: w.focus,
          km: w.kmLabel,
          sti: `/weeks/${wi}`,
          sessioner: w.sessions.map((s) => ({ id: s.sessionId, dag: DAG[s.day], label: s.label, valgfri: s.optional || null, betingelse: s.condition })),
        })),
        mobilitet: {
          øvelser: plan.mobility.items.map((i) => `${i.name} (${i.dose})`),
          kneeToWallUger: plan.mobility.measurement.weeks,
        },
        lyskeregler: plan.groin.rules.map((r) => `${r.color}: ${r.signal} → ${r.action}`),
        port: plan.groin.gate,
        mål: plan.goals,
      };
    },
  }),

  tool({
    name: 'hent_uge',
    title: 'En uge: planlagt og lavet',
    description:
      'Én uge: planlagt vs. lavet pr. session (dosering, løbetal, RPE, note), trafiklys pr. session, volumen pr. øvelse, løbe-km, ' +
      'aktiviteter uden for planen og dine noter til ugen. Brug sessionId herfra, når et løb skal knyttes til en planlagt session.',
    input: z.object({ uge: Uge.describe('Ugenummer i planen, fx 5') }),
    readOnly: true,
    async run({ db, now }, { uge }) {
      const today = todayInCopenhagen(now);
      const [{ plan }, summary, view, workouts, notes] = await Promise.all([
        getActivePlan(db),
        getWeeklySummary(db, uge, today),
        getWeek(db, uge),
        listWorkouts(db, { weekNo: uge }),
        listCoachNotes(db, { weekNo: uge }),
      ]);
      const sessions = view.sessions.map((ws) => {
        const s = summary.sessions.find((x) => x.sessionId === ws.session.id);
        const w = workouts.find((x) => x.planned_session_id === ws.session.id);
        const session = ws.session;
        const planned =
          session.kind === 'styrke'
            ? ws.strength?.slots.flatMap((slot) => slot.exercises.map((e) => `${e.label}: ${doseText(plan, e.exercise.id, e.planned.dose)}`))
            : session.kind === 'mobilitet'
              ? null
              : [ws.scheduled.label, session.mainSet, session.targetPace && `tempo ${session.targetPace}`].filter(Boolean).join(' · ');
        return {
          sessionId: session.id,
          navn: session.name,
          dag: DAG[ws.scheduled.day],
          dato: ws.date,
          flyttetFra: ws.scheduled.moved ? DAG[ws.scheduled.plannedDay] : null,
          valgfri: ws.scheduled.optional || null,
          status: s?.status,
          lys: s?.light,
          planlagt: planned,
          lavet: w && !w.skipped_at ? { dato: w.date, rpe: w.rpe, lyske: w.groin_during, note: w.note, ...(w.type !== 'styrke' && runOut(w, plan)), id: undefined } : null,
          sprungetOver: w?.skipped_at ? { årsag: w.skip_reason, note: w.note } : null,
        };
      });
      return {
        uge,
        start: summary.startDate,
        slut: summary.endDate,
        fase: summary.phase,
        fokus: view.week.focus,
        kmPlan: view.week.kmLabel,
        lavet: `${summary.done}/${summary.planned}`,
        sprungetOver: summary.skipped,
        løbeKm: summary.runKm,
        sessioner: sessions,
        andreAktiviteter: summary.extras.map((e) => {
          const w = workouts.find((x) => x.uuid === e.workoutUuid);
          return { dato: e.date, navn: e.name, tid: e.durationSec ? formatDuration(e.durationSec) : null, km: w?.distance_km, lys: e.light, note: w?.note };
        }),
        volumen: summary.volume.map((v) => ({ exerciseId: v.exerciseId, navn: v.name, sæt: v.sets, reps: v.reps, kg: v.volumeKg })),
        trafiklys: summary.lights,
        mobilitetsdage: summary.mobilityDays,
        noter: notes.map((n) => ({ tekst: n.text, session: n.session_id, oprettet: n.created_at.slice(0, 10) })),
      };
    },
  }),

  tool({
    name: 'hent_ovelseshistorik',
    title: 'Historik for én øvelse',
    description:
      'Hver gang en øvelse er logget, nyeste først: dato, uge, sæt med vægt/reps/side, RPE, note, og om "Klar til mere vægt" var udløst. ' +
      'Brug list_ovelser for at finde exerciseId, fx "enbens-rdl".',
    input: z.object({
      exerciseId: Slug.max(80).describe('Øvelsens id fra list_ovelser'),
      antal: z.int().min(1).max(100).default(10).describe('Hvor mange gange (standard 10)'),
    }),
    readOnly: true,
    async run({ db }, { exerciseId, antal }) {
      const [{ plan }, history] = await Promise.all([getActivePlan(db), getExerciseHistory(db, exerciseId, antal)]);
      const exercise = getExercise(plan, exerciseId);
      if (!exercise && !history.length) throw new NotFoundError(`Ukendt exerciseId "${exerciseId}". Brug list_ovelser`);
      return {
        exerciseId,
        navn: exercise?.name,
        type: exercise && KIND[exercise.kind],
        prSide: exercise?.perSide || null,
        gange: history.map((h) => {
          let ready: boolean | null = null;
          try {
            const planned = findPlannedDose(plan, h.sessionId, h.weekNo, exerciseId);
            if (planned) ready = readyForMoreWeight(planned.exercise, planned.dose, h.sets, h.rpe);
          } catch {
            // Sessionen findes ikke i den aktive plan.
          }
          return {
            dato: h.date,
            uge: h.weekNo,
            session: h.sessionId,
            sæt: h.sets.map((s) => compact({ nr: s.set_no, side: s.side, kg: s.weight_kg, reps: s.reps, sek: s.seconds })),
            rpe: h.rpe,
            note: h.note,
            topKg: h.topWeight,
            volumenKg: h.volumeKg || null,
            klarTilMereVægt: ready,
          };
        }),
      };
    },
  }),

  tool({
    name: 'list_ovelser',
    title: 'Alle øvelser',
    description: 'Alle øvelser i den aktive plan med exerciseId, navn og type. Brug den til at slå id op i stedet for at gætte.',
    input: z.object({}),
    readOnly: true,
    async run({ db }) {
      const { plan } = await getActivePlan(db);
      return plan.exercises.map((e) => ({ exerciseId: e.id, navn: e.name, type: KIND[e.kind], prSide: e.perSide || null, fokus: e.focus }));
    },
  }),

  tool({
    name: 'hent_lysketrend',
    title: 'Lyske-trend',
    description:
      'Venstre lyske pr. træning: score under træning og morgenen efter (0–10) og trafiklysfarve (grøn, gul, rød, afventer, ukendt). ' +
      'Grøn = højst 3 under og 0 næste morgen; rød = gul to gange i træk.',
    input: z.object({ fra: IsoDate.optional().describe('Fra og med dato (YYYY-MM-DD). Standard: planens start.') }),
    readOnly: true,
    async run({ db, now }, { fra }) {
      const { plan } = await getActivePlan(db);
      const trend = await getGroinTrend(db, fra ?? plan.startDate, todayInCopenhagen(now));
      return trend.map((t) => ({
        dato: t.date,
        uge: t.weekNo,
        session: t.plannedSessionId ? (getSession(plan, t.plannedSessionId)?.name ?? t.plannedSessionId) : 'uden for planen',
        under: t.during,
        morgen: t.morning,
        lys: t.light,
      }));
    },
  }),

  tool({
    name: 'hent_mobilitet',
    title: 'Ankelmobilitet',
    description:
      'Alle knee-to-wall-målinger (cm, højre og venstre) og forskellen venstre − højre over tid. Højre er den stramme side; målet er forskel 0.',
    input: z.object({}),
    readOnly: true,
    async run({ db, now }) {
      const [{ plan }, points] = await Promise.all([getActivePlan(db), getMobilityTrend(db)]);
      const due = measurementDue(points, todayInCopenhagen(now), plan.mobility.measurement.reminderDays);
      return {
        målinger: points.map((p) => ({ dato: p.date, højre: p.right, venstre: p.left, forskel: p.diff, note: p.note })),
        forskelÆndring: points.length > 1 ? Math.round((points.at(-1)!.diff - points[0].diff) * 10) / 10 : null,
        dageSidenSidste: due.days,
        planlagteUger: plan.mobility.measurement.weeks,
      };
    },
  }),

  tool({
    name: 'hent_lob',
    title: 'Løb',
    description: 'Løb i en periode med distance, tid, tempo, puls, RPE, lyske og note, ældste først.',
    input: z.object({
      fra: IsoDate.optional().describe('Fra og med (YYYY-MM-DD)'),
      til: IsoDate.optional().describe('Til og med (YYYY-MM-DD)'),
    }),
    readOnly: true,
    async run({ db }, { fra, til }) {
      const [{ plan }, runs] = await Promise.all([getActivePlan(db), listWorkouts(db, { from: fra, to: til, type: 'løb' })]);
      return runs.map((w) => runOut(w, plan));
    },
  }),

  tool({
    name: 'foreslaa_planaendring',
    title: 'Foreslå en planændring',
    description:
      'Foreslår en ændring til den aktive plan som JSON Patch (RFC 6902). Forslaget bliver ALDRIG aktivt af sig selv: ' +
      'Simon godkender eller afviser det i appen. Hent stierne med hent_plan (og evt. hent_plan med "sti" for rå JSON). ' +
      'Regler: et exerciseId må aldrig ændres, fjernes eller genbruges — nye øvelser tilføjes til /exercises med et nyt id. ' +
      'Resultatet skal bestå plan-skemaet. Svaret indeholder forslagets id og en læsbar diff; vis diffen til Simon.',
    input: z.object({
      summary: z.string().trim().min(3).max(200).describe('Kort titel, bliver noten på den nye planversion. Fx "Enbens RDL 3 × 10 i uge 5–8"'),
      rationale: z.string().trim().min(1).max(4000).describe('Hvorfor, ud fra data'),
      patch: JsonPatch.describe(`JSON Patch mod den aktive planversion. Højst 200 operationer og ${MAX_PATCH_BYTES / 1000} KB.`),
    }),
    readOnly: false,
    async run({ db, now }, input) {
      const p = await createProposal(db, input, now.toISOString());
      return {
        id: p.id,
        status: p.status,
        modVersion: p.baseVersion,
        diff: p.diff,
        besked: 'Forslaget venter på godkendelse i appen. Intet er ændret endnu.',
      };
    },
  }),

  tool({
    name: 'log_lob',
    title: 'Log et løb',
    description:
      'Logger et løb i appen. Brug KUN når Simon beder om det. Angiv sessionId (fra hent_uge), hvis løbet er en planlagt session; ' +
      'ellers logges det som et løb uden for planen. Svarer med det oprettede, så du kan bekræfte tallene.',
    input: z.object({
      dato: IsoDate.optional().describe('YYYY-MM-DD. Standard: i dag'),
      distanceKm: z.number().positive().max(100),
      tid: z.string().max(10).describe('Varighed, "mm:ss" eller "t:mm:ss"'),
      puls: z.int().min(30).max(250).optional().describe('Gennemsnitspuls'),
      rpe: z.number().min(1).max(10).multipleOf(0.5).optional(),
      lyske: z.int().min(0).max(10).optional().describe('Venstre lyske under løbet, 0–10'),
      note: z.string().trim().max(1000).optional(),
      sessionId: Slug.max(80).optional().describe('Planens løbesession i ugen, fx "t1"'),
    }),
    readOnly: false,
    async run({ db, now }, i) {
      const { plan } = await getActivePlan(db);
      const w = await logRun(
        db,
        {
          date: i.dato ?? todayInCopenhagen(now),
          distanceKm: i.distanceKm,
          durationSec: parseTid(i.tid),
          avgHr: i.puls ?? null,
          rpe: i.rpe ?? null,
          groinDuring: i.lyske ?? null,
          note: i.note ?? null,
          sessionId: i.sessionId ?? null,
        },
        now,
      );
      return { oprettet: runOut(w, plan) };
    },
  }),

  tool({
    name: 'skriv_note',
    title: 'Skriv en note til Simon',
    description:
      'Efterlader en note i appen, knyttet til en uge, en session i en uge, eller generel (uden uge). Brug når Simon beder om det, ' +
      'eller når en kort påmindelse hører til en bestemt uge eller session. Noten vises, til Simon lukker den.',
    input: z.object({
      tekst: Tekst(2000),
      uge: Uge.optional().describe('Ugenummer. Udelades for en generel note.'),
      sessionId: Slug.max(80).optional().describe('Session i ugen, fx "styrke-a". Uden uge bruges denne uge.'),
    }),
    readOnly: false,
    async run({ db, now }, { tekst, uge, sessionId }) {
      let weekNo = uge ?? null;
      if (sessionId && weekNo === null) {
        const { plan } = await getActivePlan(db);
        weekNo = weekForDate(plan, todayInCopenhagen(now))?.weekNo ?? null;
        if (weekNo === null) throw new ValidationError('Angiv uge: i dag ligger uden for planen');
      }
      const n = await createCoachNote(db, { text: tekst, weekNo, sessionId: sessionId ?? null }, now.toISOString());
      return { id: n.uuid, uge: n.week_no, session: n.session_id, tekst: n.text, besked: 'Noten vises i appen.' };
    },
  }),
];

// ─── Kald med validering, fejlhåndtering og revisionslog ────────────────────

export interface ToolResult {
  ok: boolean;
  text: string;
  error?: McpErrorKind;
}

function classify(e: unknown): { kind: McpErrorKind; message: string } {
  if (e instanceof ZodError)
    return {
      kind: 'ugyldigt-input',
      message: `Ugyldige argumenter: ${e.issues
        .slice(0, 8)
        .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
        .join('; ')}`,
    };
  const status = (e as { status?: number }).status;
  const message = (e as Error).message;
  if (status === 400) return { kind: 'ugyldigt-input', message };
  if (status === 404) return { kind: 'ikke-fundet', message };
  if (status === 409) return { kind: 'konflikt', message };
  console.error(e);
  return { kind: 'serverfejl', message: 'Serverfejl. Prøv igen senere.' };
}

/** Validerer input, kører værktøjet og logger kaldet (uden input-indhold) i mcp_audit. */
export async function callTool(db: D1Database, name: string, args: unknown, now = new Date()): Promise<ToolResult> {
  const started = Date.now();
  const def = TOOLS.find((t) => t.name === name);
  let result: ToolResult;
  if (!def) result = { ok: false, text: `Ukendt værktøj: ${name}`, error: 'ikke-fundet' };
  else
    try {
      const input = def.input.parse(args ?? {});
      result = { ok: true, text: JSON.stringify(compact(await def.run({ db, now }, input))) };
    } catch (e) {
      const { kind, message } = classify(e);
      result = { ok: false, text: message, error: kind };
    }
  try {
    await recordMcpCall(db, { tool: def ? name : 'ukendt', ok: result.ok, error: result.error ?? null, durationMs: Date.now() - started });
  } catch (e) {
    console.error('mcp_audit', e);
  }
  return result;
}
