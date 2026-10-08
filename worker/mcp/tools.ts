// MCP-værktøjerne. Tynde lag over worker/services: hvert værktøj validerer input med zod,
// kalder services og formaterer et kompakt JSON-svar med danske feltnavne og datoer som
// YYYY-MM-DD. Ingen SQL her. Alt input behandles som utroværdigt.
//
// Fase 5: en forbindelse gælder præcis én atlet (/mcp/<slug>). Konteksten bærer atleten, og
// hvert svar starter med "atlet", så Claude altid kan se, hvis data det er.
// Ingen værktøjer sletter, aktiverer planversioner, godkender forslag eller ændrer logs.
import { z, ZodError } from 'zod';
import type { Role } from '../../shared/athletes';
import { DEFAULT_REMINDER_DAYS, measurementDue } from '../../shared/mobility';
import { formatDuration, formatPace } from '../../shared/pace';
import { IsoDate, Slug, type Dose, type Plan, type Session, type WeekRange } from '../../shared/plan.schema';
import { formatWeekList } from '../../shared/planDiff';
import { readyForMoreWeight, findPlannedDose } from '../../shared/progression';
import type { PainScore, Workout } from '../../shared/records.schema';
import { dateOfDay, formatDose, formatIntensity, getExercise, getSession, weekForDate } from '../../shared/resolve';
import { getAt, JsonPatch, PatchError } from '../../shared/jsonPatch';
import { getSharing, listMobilityTests, listMonitors, type Athlete } from '../services/athletes';
import { recordMcpCall, type McpErrorKind } from '../services/audit';
import { addDays, todayInCopenhagen } from '../services/clock';
import { ForbiddenError, NotFoundError, ValidationError } from '../services/errors';
import { getExerciseHistory, getWeeklySummary, readPainScores } from '../services/history';
import { listCoachNotes, createCoachNote } from '../services/notes';
import { findActivePlan, getActivePlan, getPlanVersion, getWeek } from '../services/plan';
import { createMonitoringProposal, createNewPlanProposal, createProposal, listProposals, MAX_PATCH_BYTES, MAX_PLAN_BYTES, MonitoringChange } from '../services/proposals';
import { getMobilityTrend, getPainTrend } from '../services/trends';
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

/** Under-scorer pr. træning: [{ monitor: "Venstre lyske", score: 2 }]. */
type PainOf = (workoutUuid: string) => { monitor: string; score: number }[];

async function painLookup(ctx: ToolContext): Promise<PainOf> {
  const [scores, monitors] = await Promise.all([readPainScores(ctx.db, ctx.athlete.id), listMonitors(ctx.db, ctx.athlete.id)]);
  const label = new Map(monitors.map((m) => [m.id, m.label]));
  const byWorkout = new Map<string, PainScore[]>();
  for (const s of scores) if (s.kind === 'under' && s.workout_uuid) byWorkout.set(s.workout_uuid, [...(byWorkout.get(s.workout_uuid) ?? []), s]);
  return (uuid) => (byWorkout.get(uuid) ?? []).map((s) => ({ monitor: label.get(s.monitor_id) ?? `monitor ${s.monitor_id}`, score: s.score }));
}

function runOut(w: Workout, plan: Plan | null, pain: PainOf) {
  return {
    id: w.uuid,
    dato: w.date,
    uge: w.week_no,
    session: w.planned_session_id ? ((plan && getSession(plan, w.planned_session_id)?.name) ?? w.planned_session_id) : 'uden for planen',
    distanceKm: w.distance_km,
    tid: w.duration_sec ? formatDuration(w.duration_sec) : null,
    tempo: formatPace(w.duration_sec, w.distance_km) ? `${formatPace(w.duration_sec, w.distance_km)}/km` : null,
    puls: w.avg_hr,
    rpe: w.rpe,
    smerte: pain(w.uuid),
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

const genitive = (name: string) => (/[sxz]$/i.test(name) ? `${name}'` : `${name}s`);

// ─── Værktøjer ──────────────────────────────────────────────────────────────

export interface ToolContext {
  db: D1Database;
  now: Date;
  /** Forbindelsens atlet. Værktøjerne når aldrig andre atleters data. */
  athlete: Athlete;
  /** Brugeren der gav Claude adgang, og brugerens rolle lige nu (slået op ved hvert kald). */
  userId: number;
  role: Role;
}

export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: S;
  readOnly: boolean;
  /** Kræver rollen ejer (fx log_lob). */
  ownerOnly?: boolean;
  run: (ctx: ToolContext, input: z.output<S>) => Promise<Record<string, unknown>>;
}

const tool = <S extends z.ZodObject>(def: ToolDef<S>) => def as unknown as ToolDef;

const Uge = z.int().min(1).max(60);
const Tekst = (max: number) => z.string().trim().min(1).max(max);
const Summary = z.string().trim().min(3).max(200);
const Rationale = z.string().trim().min(1).max(4000).describe('Hvorfor, ud fra data');

const smerteTrend = tool({
  name: 'hent_smertetrend',
  title: 'Smerte-trend',
  description:
    'Smerte pr. monitor (fx "Venstre lyske") og træning: score under træning og morgenen efter (0–10) og trafiklys (grøn, gul, rød, afventer, ukendt). ' +
    'Grøn = højst 3 under og 0 næste morgen; rød = gul to gange i træk. Reglen gælder pr. monitor.',
  input: z.object({ fra: IsoDate.optional().describe('Fra og med dato (YYYY-MM-DD). Standard: planens start.') }),
  readOnly: true,
  async run(ctx, { fra }) {
    const active = await findActivePlan(ctx.db, ctx.athlete.id);
    const trend = await getPainTrend(ctx.db, ctx.athlete.id, fra ?? active?.plan.startDate ?? '0000-01-01', todayInCopenhagen(ctx.now), { includeInactive: true });
    return {
      monitors: trend.map(({ monitor, assessments }) => ({
        id: monitor.id,
        monitor: monitor.label,
        aktiv: monitor.active,
        træninger: assessments.map((t) => ({
          dato: t.date,
          uge: t.weekNo,
          session: t.plannedSessionId ? ((active && getSession(active.plan, t.plannedSessionId)?.name) ?? t.plannedSessionId) : 'uden for planen',
          under: t.during,
          morgen: t.morning,
          lys: t.light,
        })),
      })),
    };
  },
});

export const TOOLS: ToolDef[] = [
  tool({
    name: 'hent_status',
    title: 'Status lige nu',
    description:
      'Overblik lige nu: dags dato, hvilken uge af planen og fase, dagens og ugens sessioner med status, trafiklys pr. smerte-monitor de sidste 7 dage, ' +
      'dage siden sidste måling pr. mobilitetstest, ventende forslag og åbne noter. Brug det først i en samtale om træningen.',
    input: z.object({}),
    readOnly: true,
    async run(ctx) {
      const { db, now, athlete } = ctx;
      const today = todayInCopenhagen(now);
      const [active, pain, mobility, proposals, notes] = await Promise.all([
        findActivePlan(db, athlete.id),
        getPainTrend(db, athlete.id, addDays(today, -6), today),
        getMobilityTrend(db, athlete.id),
        listProposals(db, athlete.id, { status: 'afventer' }),
        listCoachNotes(db, athlete.id),
      ]);
      const base = {
        dato: today,
        ugedag: UGEDAG[weekdayOf(today)],
        smerteSeneste7Dage: pain.map(({ monitor, assessments }) => ({
          monitor: monitor.label,
          træninger: assessments.map((l) => ({ dato: l.date, under: l.during, morgen: l.morning, lys: l.light })),
        })),
        ventendeForslag: proposals.map((p) => ({ id: p.id, slags: p.kind, summary: p.summary, oprettet: p.createdAt.slice(0, 10) })),
        åbneNoter: notes.length,
      };
      if (!active) return { ...base, plan: 'Ingen aktiv plan endnu. Hent profilen med hent_profil og lav en plan med foreslaa_ny_plan.' };
      const { meta, plan } = active;
      const week = weekForDate(plan, today);
      let uge: unknown = null;
      if (week) {
        const summary = await getWeeklySummary(db, athlete.id, week.weekNo, today);
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
      const reminderDays = plan.mobility?.measurement?.reminderDays ?? DEFAULT_REMINDER_DAYS;
      return {
        ...base,
        planversion: meta.version,
        planStart: plan.startDate,
        løbsdato: plan.raceDate,
        uge: uge ?? (today < plan.startDate ? 'planen er ikke startet' : 'planen er slut'),
        mobilitetstests: mobility.map(({ test, points }) => {
          const due = measurementDue(points, today, reminderDays);
          return { test: test.name, dageSidenSidste: due.days, påmindelseEfterDage: reminderDays, skalMåles: due.due };
        }),
      };
    },
  }),

  tool({
    name: 'hent_profil',
    title: 'Atletens profil',
    description:
      'Atletens navn, tærskelpuls, aktive smerte-monitors og mobilitetstests (med id), aktiv planversion og periode, og hvem der har adgang med hvilken rolle. ' +
      'Brug den før du laver en ny plan eller foreslår ændringer af overvågningen.',
    input: z.object({}),
    readOnly: true,
    async run({ db, athlete }) {
      const [monitors, tests, active, owner] = await Promise.all([
        listMonitors(db, athlete.id),
        listMobilityTests(db, athlete.id),
        findActivePlan(db, athlete.id),
        db.prepare("SELECT user_id FROM athlete_access WHERE athlete_id = ? AND role = 'ejer' LIMIT 1").bind(athlete.id).first<number>('user_id'),
      ]);
      const sharing = owner ? await getSharing(db, athlete.id, owner) : { access: [] };
      return {
        navn: athlete.name,
        tærskelpuls: athlete.threshold_hr,
        monitors: monitors.map((m) => ({ id: m.id, monitor: m.label, aktiv: m.active })),
        mobilitetstests: tests.map((t) => ({ id: t.id, navn: t.name, enhed: t.unit, prSide: t.per_side, aktiv: t.active, instruktion: t.instructions })),
        plan: active
          ? {
              version: active.meta.version,
              titel: active.plan.title,
              start: active.plan.startDate,
              løbsdato: active.plan.raceDate,
              uger: active.plan.weeks.length,
              slut: dateOfDay(active.plan.weeks.at(-1)!, 7),
            }
          : 'ingen aktiv plan endnu',
        adgang: sharing.access.map((a) => ({ navn: a.name, rolle: a.role })),
      };
    },
  }),

  tool({
    name: 'hent_plan',
    title: 'Planen',
    description:
      'Den aktive planversion (eller en angivet version) i kompakt form: sessioner, øvelser og dosering pr. ugeinterval, ugeprogrammet, ' +
      'mobilitet og trafiklysregler. Hver variant og uge har en "sti" (JSON Pointer). Angiv "sti" for at få den rå JSON under stien, ' +
      'fx "/sessions/2/slots/1" — brug det, når du skal skrive en patch til foreslaa_planaendring.',
    input: z.object({
      version: z.int().min(1).optional().describe('Planversion. Udelades for den aktive.'),
      sti: z.string().max(300).optional().describe('JSON Pointer ind i planen, fx "/weeks/4". Giver rå JSON for netop den del.'),
    }),
    readOnly: true,
    async run({ db, athlete }, { version, sti }) {
      const { meta, plan } = version ? await getPlanVersion(db, athlete.id, version) : await getActivePlan(db, athlete.id);
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
        mobilitet: plan.mobility && {
          øvelser: plan.mobility.items.map((i) => `${i.name} (${i.dose})`),
          målingUger: plan.mobility.measurement?.weeks,
        },
        trafiklysregler: plan.groin?.rules.map((r) => `${r.color}: ${r.signal} → ${r.action}`),
        port: plan.groin?.gate,
        mål: plan.goals,
      };
    },
  }),

  tool({
    name: 'hent_uge',
    title: 'En uge: planlagt og lavet',
    description:
      'Én uge: planlagt vs. lavet pr. session (dosering, løbetal, RPE, smerte, note), trafiklys pr. session, volumen pr. øvelse, løbe-km, ' +
      'aktiviteter uden for planen og noter til ugen. Brug sessionId herfra, når et løb skal knyttes til en planlagt session.',
    input: z.object({ uge: Uge.describe('Ugenummer i planen, fx 5') }),
    readOnly: true,
    async run(ctx, { uge }) {
      const { db, now, athlete } = ctx;
      const today = todayInCopenhagen(now);
      const [{ plan }, summary, view, workouts, notes, pain] = await Promise.all([
        getActivePlan(db, athlete.id),
        getWeeklySummary(db, athlete.id, uge, today),
        getWeek(db, athlete.id, uge),
        listWorkouts(db, athlete.id, { weekNo: uge }),
        listCoachNotes(db, athlete.id, { weekNo: uge }),
        painLookup(ctx),
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
          lavet:
            w && !w.skipped_at
              ? { dato: w.date, rpe: w.rpe, smerte: pain(w.uuid), note: w.note, ...(w.type !== 'styrke' && runOut(w, plan, pain)), id: undefined }
              : null,
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
    async run({ db, athlete }, { exerciseId, antal }) {
      const [active, history] = await Promise.all([findActivePlan(db, athlete.id), getExerciseHistory(db, athlete.id, exerciseId, antal)]);
      const plan = active?.plan;
      const exercise = plan && getExercise(plan, exerciseId);
      if (!exercise && !history.length) throw new NotFoundError(`Ukendt exerciseId "${exerciseId}". Brug list_ovelser`);
      return {
        exerciseId,
        navn: exercise?.name,
        type: exercise && KIND[exercise.kind],
        prSide: exercise?.perSide || null,
        gange: history.map((h) => {
          let ready: boolean | null = null;
          try {
            const planned = plan && findPlannedDose(plan, h.sessionId, h.weekNo, exerciseId);
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
    async run({ db, athlete }) {
      const { plan } = await getActivePlan(db, athlete.id);
      return { øvelser: plan.exercises.map((e) => ({ exerciseId: e.id, navn: e.name, type: KIND[e.kind], prSide: e.perSide || null, fokus: e.focus })) };
    },
  }),

  smerteTrend,
  // Det gamle navn fra fase 3 virker i én version mere.
  { ...smerteTrend, name: 'hent_lysketrend', title: 'Lyske-trend (forældet navn)', description: 'Forældet navn for hent_smertetrend. Brug hent_smertetrend.' },

  tool({
    name: 'hent_mobilitet',
    title: 'Mobilitetstests',
    description:
      'Alle målinger pr. mobilitetstest (fx knee-to-wall i cm, højre og venstre). For tests pr. side vises forskellen venstre − højre over tid.',
    input: z.object({}),
    readOnly: true,
    async run({ db, now, athlete }) {
      const [active, trend] = await Promise.all([findActivePlan(db, athlete.id), getMobilityTrend(db, athlete.id, { includeInactive: true })]);
      const reminderDays = active?.plan.mobility?.measurement?.reminderDays ?? DEFAULT_REMINDER_DAYS;
      return {
        tests: trend.map(({ test, points }) => {
          const due = measurementDue(points, todayInCopenhagen(now), reminderDays);
          const diffs = points.map((p) => p.diff).filter((d): d is number => d != null);
          return {
            id: test.id,
            test: test.name,
            enhed: test.unit,
            aktiv: test.active,
            målinger: points.map((p) => ({ dato: p.date, højre: p.right, venstre: p.left, værdi: p.value, forskel: p.diff, note: p.note })),
            forskelÆndring: diffs.length > 1 ? Math.round((diffs.at(-1)! - diffs[0]) * 10) / 10 : null,
            dageSidenSidste: due.days,
          };
        }),
        planlagteUger: active?.plan.mobility?.measurement?.weeks,
      };
    },
  }),

  tool({
    name: 'hent_lob',
    title: 'Løb',
    description: 'Løb i en periode med distance, tid, tempo, puls, RPE, smerte og note, ældste først.',
    input: z.object({
      fra: IsoDate.optional().describe('Fra og med (YYYY-MM-DD)'),
      til: IsoDate.optional().describe('Til og med (YYYY-MM-DD)'),
    }),
    readOnly: true,
    async run(ctx, { fra, til }) {
      const [active, runs, pain] = await Promise.all([
        findActivePlan(ctx.db, ctx.athlete.id),
        listWorkouts(ctx.db, ctx.athlete.id, { from: fra, to: til, type: 'løb' }),
        painLookup(ctx),
      ]);
      return { løb: runs.map((w) => runOut(w, active?.plan ?? null, pain)) };
    },
  }),

  tool({
    name: 'foreslaa_planaendring',
    title: 'Foreslå en planændring',
    description:
      'Foreslår en ændring til den aktive plan som JSON Patch (RFC 6902). Forslaget bliver ALDRIG aktivt af sig selv: ' +
      'atleten godkender eller afviser det i appen. Hent stierne med hent_plan (og evt. hent_plan med "sti" for rå JSON). ' +
      'Regler: et exerciseId må aldrig ændres, fjernes eller genbruges — nye øvelser tilføjes til /exercises med et nyt id. ' +
      'Resultatet skal bestå plan-skemaet. Har atleten ingen plan, så brug foreslaa_ny_plan. Svaret har forslagets id og en læsbar diff; vis diffen.',
    input: z.object({
      summary: Summary.describe('Kort titel, bliver noten på den nye planversion. Fx "Enbens RDL 3 × 10 i uge 5–8"'),
      rationale: Rationale,
      patch: JsonPatch.describe(`JSON Patch mod den aktive planversion. Højst 200 operationer og ${MAX_PATCH_BYTES / 1000} KB.`),
    }),
    readOnly: false,
    async run({ db, now, athlete }, input) {
      const p = await createProposal(db, athlete.id, input, now.toISOString());
      return { id: p.id, status: p.status, modVersion: p.baseVersion, diff: p.diff, besked: 'Forslaget venter på godkendelse i appen. Intet er ændret endnu.' };
    },
  }),

  tool({
    name: 'foreslaa_ny_plan',
    title: 'Foreslå en ny plan',
    description:
      'Foreslår en komplet plan (samme JSON-format som hent_plan med "sti": ""), fx atletens første plan eller en ny blok. ' +
      'Planen valideres mod plan-skemaet og lander som et forslag, som atleten godkender i appen; så bliver den den aktive planversion. ' +
      'Et exerciseId der har været brugt før, må ikke skifte betydning. Hent profilen med hent_profil først (monitors, tærskelpuls).',
    input: z.object({
      summary: Summary.describe('Kort titel, fx "Første plan: 12 uger mod 10 km"'),
      rationale: Rationale,
      plan: z.record(z.string(), z.unknown()).describe(`Hele planen som JSON (schemaVersion 1). Højst ${MAX_PLAN_BYTES / 1000} KB.`),
    }),
    readOnly: false,
    async run({ db, now, athlete }, input) {
      const p = await createNewPlanProposal(db, athlete.id, input, now.toISOString());
      return { id: p.id, status: p.status, diff: p.diff, besked: 'Planen venter på godkendelse i appen. Intet er ændret endnu.' };
    },
  }),

  tool({
    name: 'foreslaa_overvaagning',
    title: 'Foreslå ændret overvågning',
    description:
      'Foreslår at tilføje eller deaktivere en smerte-monitor (fx "Højre knæ") eller en mobilitetstest (fx "Knee-to-wall", cm, pr. side). ' +
      'Godkendes i appen som andre forslag. Id\'er til deaktivering findes med hent_profil.',
    input: z.object({
      summary: Summary.describe('Kort titel, fx "Overvåg højre knæ"'),
      rationale: Rationale,
      ændringer: z.array(MonitoringChange).min(1).max(10),
    }),
    readOnly: false,
    async run({ db, now, athlete }, { summary, rationale, ændringer }) {
      const p = await createMonitoringProposal(db, athlete.id, { summary, rationale, changes: ændringer }, now.toISOString());
      return { id: p.id, status: p.status, diff: p.diff, besked: 'Forslaget venter på godkendelse i appen.' };
    },
  }),

  tool({
    name: 'log_lob',
    title: 'Log et løb',
    description:
      'Logger et løb i appen. Brug KUN når atleten selv beder om det (kræver at forbindelsen er atletens egen, ikke en træners). ' +
      'Angiv sessionId (fra hent_uge), hvis løbet er en planlagt session; ellers logges det som et løb uden for planen. Svarer med det oprettede.',
    input: z.object({
      dato: IsoDate.optional().describe('YYYY-MM-DD. Standard: i dag'),
      distanceKm: z.number().positive().max(100),
      tid: z.string().max(10).describe('Varighed, "mm:ss" eller "t:mm:ss"'),
      puls: z.int().min(30).max(250).optional().describe('Gennemsnitspuls'),
      rpe: z.number().min(1).max(10).multipleOf(0.5).optional(),
      smerte: z
        .array(z.object({ monitorId: z.int().min(1), score: z.int().min(0).max(10) }))
        .max(20)
        .optional()
        .describe('Smerte under løbet pr. monitor (id fra hent_profil), 0–10'),
      note: z.string().trim().max(1000).optional(),
      sessionId: Slug.max(80).optional().describe('Planens løbesession i ugen, fx "t1"'),
    }),
    readOnly: false,
    ownerOnly: true,
    async run(ctx, i) {
      const { db, now, athlete } = ctx;
      const { plan } = await getActivePlan(db, athlete.id);
      const { workout } = await logRun(
        db,
        athlete.id,
        {
          date: i.dato ?? todayInCopenhagen(now),
          distanceKm: i.distanceKm,
          durationSec: parseTid(i.tid),
          avgHr: i.puls ?? null,
          rpe: i.rpe ?? null,
          pain: i.smerte ?? [],
          note: i.note ?? null,
          sessionId: i.sessionId ?? null,
        },
        now,
      );
      return { oprettet: runOut(workout, plan, await painLookup(ctx)) };
    },
  }),

  tool({
    name: 'skriv_note',
    title: 'Skriv en note til atleten',
    description:
      'Efterlader en note i appen, knyttet til en uge, en session i en uge, eller generel (uden uge). Brug når der bliver bedt om det, ' +
      'eller når en kort påmindelse hører til en bestemt uge eller session. Noten vises, til atleten lukker den.',
    input: z.object({
      tekst: Tekst(2000),
      uge: Uge.optional().describe('Ugenummer. Udelades for en generel note.'),
      sessionId: Slug.max(80).optional().describe('Session i ugen, fx "styrke-a". Uden uge bruges denne uge.'),
    }),
    readOnly: false,
    async run({ db, now, athlete }, { tekst, uge, sessionId }) {
      let weekNo = uge ?? null;
      if (sessionId && weekNo === null) {
        const { plan } = await getActivePlan(db, athlete.id);
        weekNo = weekForDate(plan, todayInCopenhagen(now))?.weekNo ?? null;
        if (weekNo === null) throw new ValidationError('Angiv uge: i dag ligger uden for planen');
      }
      const n = await createCoachNote(db, athlete.id, { text: tekst, weekNo, sessionId: sessionId ?? null }, now.toISOString());
      return { id: n.uuid, uge: n.week_no, session: n.session_id, tekst: n.text, besked: 'Noten vises i appen.' };
    },
  }),
];

/** Navn og instruktioner for forbindelsen, så Claude ved hvis data den indeholder. */
export function serverInfo(athlete: Pick<Athlete, 'name'>, role: Role) {
  const whose = genitive(athlete.name);
  return {
    name: `Træningsnav – ${athlete.name}`,
    instructions:
      `Denne forbindelse indeholder kun ${whose} træningsdata (plan, logs, smerte og mobilitet). Brug den ikke til andres træning. ` +
      'Start med hent_status, og hent_profil når du skal kende monitors, tests og tærskelpuls. Datoer er YYYY-MM-DD i dansk tid. ' +
      `Ændringer foreslås med foreslaa_planaendring, foreslaa_ny_plan og foreslaa_overvaagning og godkendes af ${athlete.name} i appen. ` +
      (role === 'ejer'
        ? 'log_lob og skriv_note bruges kun, når der bliver bedt om det.'
        : `Du er forbundet som træner: du kan læse og foreslå, men ikke logge løb for ${athlete.name}.`),
  };
}

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
  if (status === 403) return { kind: 'ingen-adgang', message };
  if (status === 404) return { kind: 'ikke-fundet', message };
  if (status === 409) return { kind: 'konflikt', message };
  console.error(e);
  return { kind: 'serverfejl', message: 'Serverfejl. Prøv igen senere.' };
}

/** Validerer input, kører værktøjet for forbindelsens atlet og logger kaldet (uden input-indhold) i mcp_audit. */
export async function callTool(ctx: ToolContext, name: string, args: unknown): Promise<ToolResult> {
  const started = Date.now();
  const def = TOOLS.find((t) => t.name === name);
  const atlet = { slug: ctx.athlete.slug, navn: ctx.athlete.name };
  let result: ToolResult;
  if (!def) result = { ok: false, text: JSON.stringify({ atlet, fejl: `Ukendt værktøj: ${name}` }), error: 'ikke-fundet' };
  else
    try {
      if (def.ownerOnly && ctx.role !== 'ejer') throw new ForbiddenError(`${def.name} kan kun bruges på ${genitive(ctx.athlete.name)} egen forbindelse, ikke som træner`);
      const input = def.input.parse(args ?? {});
      result = { ok: true, text: JSON.stringify(compact({ atlet, ...(await def.run(ctx, input)) })) };
    } catch (e) {
      const { kind, message } = classify(e);
      result = { ok: false, text: JSON.stringify({ atlet, fejl: message }), error: kind };
    }
  try {
    await recordMcpCall(ctx.db, {
      tool: def ? name : 'ukendt',
      ok: result.ok,
      error: result.error ?? null,
      durationMs: Date.now() - started,
      userId: ctx.userId,
      athleteId: ctx.athlete.id,
    });
  } catch (e) {
    console.error('mcp_audit', e);
  }
  return result;
}
