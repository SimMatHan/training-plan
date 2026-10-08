// Kalenderfeedet: aktiv plan + logs → VEVENTs. Ren logik uden D1, så den kan testes direkte.
//
//   planlagt, ikke lavet    planens (evt. flyttede) dag i ugen
//   lavet                   flyttes til den faktiske dato, "✓ " foran titlen
//   sprunget over / misset  "– " foran titlen (misset = ugen er passeret uden træning)
//   løbet og planens mål    heldagsevents
//
// UID er stabilt pr. session og uge, så kalenderen opdaterer eventet i stedet for at lave
// dubletter. SEQUENCE og LAST-MODIFIED afledes af det seneste tidsstempel blandt alt, der
// påvirker eventet (planskift, træning, sæt, smerte, flytning, indstilling), så de stiger
// ved hver ændring uden at noget skal gemmes.
import { defaultSetting, type CalendarSetting } from '../../shared/calendar';
import { assessAllPain, nextDay, type PainAssessment } from '../../shared/pain';
import { countedSets } from '../../shared/history';
import { formatDuration, formatPace } from '../../shared/pace';
import type { Plan, RunSession, ScheduledSession, Session, StrengthSession, Week } from '../../shared/plan.schema';
import type { PainScore, ScheduleOverride, SetLog, Workout } from '../../shared/records.schema';
import { dateOfDay, formatDose, formatIntensity, formatNumber, formatRange, getExercise, getSession, resolveStrengthSession } from '../../shared/resolve';
import { effectiveSessions } from '../../shared/schedule';
import { copenhagenDate, copenhagenMidnight, copenhagenTimezone, icalDate, icalLocal, icalUtc, serialize, text, TZID, type Component, type Prop } from './ical';

export interface FeedInput {
  plan: Plan;
  planVersion: number;
  /** Hvornår den aktive version blev aktiv (activated_at, ellers created_at). */
  planChangedAt: string;
  /** Planlagte træninger, inklusive tombstones (de tæller med i SEQUENCE). */
  workouts: Workout[];
  /** Sæt til træningerne, inklusive tombstones. */
  sets: SetLog[];
  /** Smertescorer, inklusive tombstones (de tæller med i SEQUENCE). */
  painScores: PainScore[];
  /** Aktive monitors (fx "Venstre lyske"), i visningsrækkefølge. */
  monitors: { id: number; label: string }[];
  /** Flytninger, inklusive tombstones (en tombstone flytter sessionen tilbage). */
  overrides: ScheduleOverride[];
  settings: CalendarSetting[];
  /** Appens adresse til dybe links, fx https://traeningsnav.x.workers.dev */
  origin: string;
  /** Nu (ms). Afgør hvilke uger der er passeret. */
  now: number;
}

export type EventState = 'planlagt' | 'lavet' | 'i-gang' | 'sprunget-over' | 'misset' | 'mål';

export interface CalendarEvent {
  uid: string;
  summary: string;
  description: string;
  date: string;
  /** 'HH:MM' (dansk tid), eller null for heldag. */
  startTime: string | null;
  durationMin: number | null;
  /** ms. Bruges til DTSTAMP, LAST-MODIFIED og SEQUENCE. */
  lastModified: number;
  sequence: number;
  url?: string;
  category: string;
  state: EventState;
}

export const UID_DOMAIN = 'traeningsnav';
export const sessionUid = (sessionId: string, weekNo: number) => `${sessionId}-uge${weekNo}@${UID_DOMAIN}`;

/** SEQUENCE = sekunder fra 1/1 2026 til seneste ændring: stiger altid, passer i 32 bit til 2094. */
const SEQUENCE_EPOCH = Date.UTC(2026, 0, 1);
export const sequenceOf = (lastModified: number) => Math.max(0, Math.floor((lastModified - SEQUENCE_EPOCH) / 1000));

const WEEKDAYS = ['', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
const weekdayOf = (iso: string) => WEEKDAYS[((new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1];
/** '2026-10-09' → 'fredag 9/10'. */
const dayLabel = (iso: string) => `${weekdayOf(iso)} ${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;

const ts = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);
const alive = <T extends { deleted_at: string | null }>(r: T) => !r.deleted_at;
const stripParens = (s: string) => s.replace(/\s*\(.*\)\s*$/, '');
/** "Tærskel" → "tærskel", men "VO2max" bevares. */
const lcFirst = (s: string) => (/^\p{Lu}\p{Ll}/u.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const ucFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Titler ─────────────────────────────────────────────────────────────────

/** Kort titel til låseskærmen: "Styrke A", "Løb — 3×10 min tærskel", "Crosstrainer — 40 min". */
export function sessionSummary(session: Session, scheduled: ScheduledSession): string {
  if (session.kind === 'styrke' || session.kind === 'mobilitet') return session.name + (/\(let\)/.test(scheduled.label) ? ' (let)' : '');
  return runSummary(session, scheduled);
}

function runSummary(session: RunSession, s: ScheduledSession): string {
  const type = stripParens(session.workoutType);
  const main = session.mainSet.split(',')[0].trim();
  if (session.kind === 'cardio') {
    const amount = s.targetMin ? formatRange(s.targetMin, ' min') : s.targetKm ? formatRange(s.targetKm, ' km') : main;
    return `${type} — ${amount}`;
  }
  // Intervaller og tærskel: "3 × 10 min" + "Tærskel" → "3×10 min tærskel".
  if (/^\d+\s*×\s*\d/.test(main)) return `Løb — ${main.replace(/\s*×\s*/, '×')} ${lcFirst(type)}`;
  // Distanceløb: ugens distance (fx 5 km i stedet for planens 5–7 km), beskrivelse og evt. strides.
  const strides = /strides/i.test(main) || /strides/i.test(s.label);
  const body = main.replace(/\s*\+.*$/, '');
  const m = body.match(/^(\d+(?:,\d+)?(?:\s*–\s*\d+(?:,\d+)?)?)\s*km\b\s*(.*)$/);
  const distance = s.targetKm ? formatRange(s.targetKm) : m?.[1];
  const descriptor = (m ? m[2] : body) || lcFirst(type);
  return `Løb — ${[distance && `${distance} km`, descriptor].filter(Boolean).join(' ')}${strides ? ' + strides' : ''}`;
}

// ─── Beskrivelser ───────────────────────────────────────────────────────────

/** Øvelser med ugens dosering, én pr. linje: "Enbens RDL — 3 × 8/side, RPE 7, 90 s". */
function strengthLines(plan: Plan, session: StrengthSession, weekNo: number): string[] {
  const lines: string[] = [];
  if (session.mobility === 'before') lines.push('Mobilitetsblok først');
  for (const slot of resolveStrengthSession(plan, session.id, weekNo).slots)
    for (const ex of slot.exercises) {
      const dose = ex.planned.dose;
      const parts = [formatDose(ex.exercise, dose), formatIntensity(dose), dose.restSec ? `${dose.restSec} s` : ''].filter(Boolean);
      lines.push(`${ex.label} — ${parts.join(', ')}`);
    }
  if (session.mobility === 'after') lines.push('Mobilitetsblok bagefter');
  return lines;
}

function runLines(session: RunSession, s: ScheduledSession): string[] {
  const lines = [[session.code, stripParens(session.workoutType)].filter(Boolean).join(' · ')];
  if (s.label !== session.code) lines.push(`Ugeplan: ${s.label}`);
  lines.push(`Hovedsæt: ${session.mainSet}`);
  if (session.rest) lines.push(`Pause: ${session.rest}`);
  if (session.targetPace) lines.push(`Fart: ${session.targetPace}`);
  if (session.warmup) lines.push(`Opvarmning: ${session.warmup}`);
  if (session.totalApprox) lines.push(`I alt: ${session.totalApprox}`);
  if (session.purpose) lines.push(`Formål: ${session.purpose}`);
  return lines;
}

/** Resultat for en lavet session: topvægt pr. øvelse (eller reps/tid), løbetal, RPE og smerte pr. monitor. */
function resultLines(
  plan: Plan,
  session: Session,
  weekNo: number,
  w: Workout,
  sets: SetLog[],
  pain: { label: string; assessment: PainAssessment }[],
): string[] {
  const lines: string[] = [];
  if (session.kind === 'styrke') {
    // Planens rækkefølge og visningsnavne for ugen; øvelser uden for planen til sidst.
    const labels = new Map(resolveStrengthSession(plan, session.id, weekNo).slots.flatMap((sl) => sl.exercises.map((e) => [e.exercise.id, e.label] as const)));
    const order = [...labels.keys()];
    const byExercise = new Map<string, SetLog[]>();
    for (const s of sets) byExercise.set(s.exercise_id, [...(byExercise.get(s.exercise_id) ?? []), s]);
    const ids = [...byExercise.keys()].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999) || a.localeCompare(b));
    for (const id of ids) {
      const counted = countedSets(byExercise.get(id)!);
      if (!counted.length) continue;
      const name = labels.get(id) ?? getExercise(plan, id)?.name ?? id;
      const weighted = counted.filter((s) => s.weight_kg != null);
      if (weighted.length) {
        const top = weighted.reduce((a, b) => (b.weight_kg! > a.weight_kg! || (b.weight_kg === a.weight_kg && (b.reps ?? 0) > (a.reps ?? 0)) ? b : a));
        lines.push(`${name}: ${formatNumber(top.weight_kg!)} kg${top.reps != null ? ` × ${top.reps}` : ''}`);
      } else if (counted.some((s) => s.seconds != null)) {
        lines.push(`${name}: ${Math.max(...counted.map((s) => s.seconds ?? 0))} sek`);
      } else if (counted.some((s) => s.reps != null)) {
        lines.push(`${name}: ${Math.max(...counted.map((s) => s.reps ?? 0))} reps`);
      }
    }
  } else if (session.kind === 'løb' || session.kind === 'cardio') {
    const pace = session.kind === 'løb' ? formatPace(w.duration_sec, w.distance_km) : undefined;
    const parts = [
      w.distance_km != null && `${formatNumber(w.distance_km)} km`,
      w.duration_sec != null && formatDuration(w.duration_sec),
      pace && `${pace}/km`,
      w.avg_hr != null && `puls ${w.avg_hr}`,
    ].filter(Boolean);
    if (parts.length) lines.push(parts.join(' · '));
  }
  if (w.rpe != null) lines.push(`RPE ${formatNumber(w.rpe)}`);
  for (const { label, assessment: a } of pain) lines.push(`${label}: ${a.during}/10 under${a.morning != null ? `, ${a.morning}/10 næste morgen` : ''}`);
  if (w.note) lines.push(`Note: ${w.note}`);
  return lines;
}

// ─── Events ─────────────────────────────────────────────────────────────────

/** Den træning der bestemmer sessionens status: lavet før i gang før sprunget over, nyeste først. */
function pickWorkout(list: Workout[]): Workout | undefined {
  const rank = (w: Workout) => (w.skipped_at ? 0 : w.finished_at ? 2 : 1);
  return list.filter(alive).sort((a, b) => rank(b) - rank(a) || b.updated_at.localeCompare(a.updated_at))[0];
}

export function buildEvents(input: FeedInput): CalendarEvent[] {
  const { plan, origin } = input;
  const today = copenhagenDate(input.now);
  const lastWeekNo = Math.max(...plan.weeks.map((w) => w.weekNo));
  const planChanged = ts(input.planChangedAt);
  const settingFor = (type: Session['kind']) => input.settings.find((s) => s.session_type === type) ?? defaultSetting(type);

  const key = (weekNo: number | null, sessionId: string | null) => `${weekNo}|${sessionId}`;
  const workoutsBySlot = new Map<string, Workout[]>();
  for (const w of input.workouts) {
    if (!w.planned_session_id) continue;
    const k = key(w.week_no, w.planned_session_id);
    workoutsBySlot.set(k, [...(workoutsBySlot.get(k) ?? []), w]);
  }
  const setsByWorkout = new Map<string, SetLog[]>();
  for (const s of input.sets) setsByWorkout.set(s.workout_uuid, [...(setsByWorkout.get(s.workout_uuid) ?? []), s]);
  const liveWorkouts = input.workouts.filter(alive);
  const assessments = assessAllPain(liveWorkouts, input.painScores, input.monitors.map((m) => m.id), today);
  const painOf = (workoutUuid: string) =>
    input.monitors.flatMap((m) => {
      const assessment = assessments.find((a) => a.workoutUuid === workoutUuid && a.monitorId === m.id);
      return assessment ? [{ label: m.label, assessment }] : [];
    });

  const events: CalendarEvent[] = [];
  for (const week of plan.weeks) {
    const weekEnd = dateOfDay(week, 7);
    const weekOverrides = input.overrides.filter((o) => o.week_no === week.weekNo);
    for (const scheduled of effectiveSessions(week, weekOverrides)) {
      const session = getSession(plan, scheduled.sessionId);
      if (!session) continue;
      const all = workoutsBySlot.get(key(week.weekNo, session.id)) ?? [];
      const workout = pickWorkout(all);
      const plannedDate = dateOfDay(week, scheduled.day);

      let state: EventState;
      if (workout?.skipped_at) state = 'sprunget-over';
      else if (workout?.finished_at) state = 'lavet';
      else if (workout) state = 'i-gang';
      else state = today > weekEnd ? 'misset' : 'planlagt';
      const date = workout ? workout.date : plannedDate;

      // Seneste ændring blandt alt der påvirker eventet. Tombstones tæller med, så en
      // fortrudt flytning eller en slettet træning også giver en højere SEQUENCE.
      const setting = settingFor(session.kind);
      const stamps = [planChanged, ts(setting.updated_at)];
      for (const o of weekOverrides) if (o.session_id === session.id) stamps.push(ts(o.updated_at));
      for (const w of all) {
        stamps.push(ts(w.updated_at));
        for (const s of setsByWorkout.get(w.uuid) ?? []) stamps.push(ts(s.updated_at));
        for (const p of input.painScores)
          if (p.workout_uuid === w.uuid || (p.kind === 'morgen' && !p.workout_uuid && p.date === nextDay(w.date))) stamps.push(ts(p.updated_at));
      }
      if (state === 'misset') stamps.push(copenhagenMidnight(nextDay(weekEnd)));
      const lastModified = Math.max(...stamps);

      const url = `${origin}/session/${encodeURIComponent(session.id)}?uge=${week.weekNo}`;
      const lines = [`Uge ${week.weekNo} af ${lastWeekNo} — ${week.phase}`];
      if (scheduled.optional) lines.push('Valgfri');
      if (scheduled.condition) lines.push(ucFirst(scheduled.condition));
      if (state === 'lavet') lines.push(`✓ Lavet ${dayLabel(date)}${date !== plannedDate ? ` (planlagt ${weekdayOf(plannedDate)})` : ''}`);
      else if (state === 'i-gang') lines.push(`I gang siden ${dayLabel(date)}`);
      else if (state === 'sprunget-over') lines.push(`Sprunget over${workout!.skip_reason ? `: ${workout!.skip_reason}` : ''}`);
      else if (state === 'misset') lines.push('Ikke lavet');
      else if (scheduled.moved) lines.push(`Flyttet fra ${weekdayOf(dateOfDay(week, scheduled.plannedDay))} til ${weekdayOf(plannedDate)}`);
      lines.push('');
      if (session.kind === 'styrke') lines.push(...strengthLines(plan, session, week.weekNo));
      else if (session.kind === 'løb' || session.kind === 'cardio') lines.push(...runLines(session, scheduled));
      if (workout && (state === 'lavet' || state === 'i-gang')) {
        const result = resultLines(plan, session, week.weekNo, workout, (setsByWorkout.get(workout.uuid) ?? []).filter(alive), painOf(workout.uuid));
        if (result.length) lines.push('', 'Resultat:', ...result);
      } else if (state === 'sprunget-over' && workout!.note) {
        lines.push('', `Note: ${workout!.note}`);
      }
      lines.push('', `Åbn i appen: ${url}`);

      const prefix = state === 'lavet' ? '✓ ' : state === 'sprunget-over' || state === 'misset' ? '– ' : '';
      const timed = !setting.all_day && setting.start_time && setting.duration_min;
      events.push({
        uid: sessionUid(session.id, week.weekNo),
        summary: prefix + sessionSummary(session, scheduled),
        description: lines.join('\n'),
        date,
        startTime: timed ? setting.start_time : null,
        durationMin: timed ? setting.duration_min : null,
        lastModified,
        sequence: sequenceOf(lastModified),
        url,
        category: session.kind === 'styrke' ? 'Styrke' : session.kind === 'løb' ? 'Løb' : session.kind === 'cardio' ? 'Cardio' : 'Mobilitet',
        state,
      });
    }
  }

  events.push(...goalEvents(plan, planChanged));
  // Stabil rækkefølge: dato, derefter planens rækkefølge.
  return events.map((e, i) => ({ e, i })).sort((a, b) => a.e.date.localeCompare(b.e.date) || a.i - b.i).map((x) => x.e);
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Løbet på raceDate og planens øvrige mål som heldagsevents. */
function goalEvents(plan: Plan, planChanged: number): CalendarEvent[] {
  const base = { startTime: null, durationMin: null, lastModified: planChanged, sequence: sequenceOf(planChanged), category: 'Mål', state: 'mål' as const };
  // Titlen tages fra ugeplanens løbsdag, fx "LØB: 5 km – sub 20" → "Mål: 5 km – sub 20".
  const raceLabel = plan.weeks
    .flatMap((w: Week) => w.sessions.filter((s) => dateOfDay(w, s.day) === plan.raceDate && getSession(plan, s.sessionId)?.kind === 'løb'))
    .map((s) => s.label)
    .find((l) => /^løb\b/i.test(l));
  const race: CalendarEvent = {
    ...base,
    uid: `maal-loebet@${UID_DOMAIN}`,
    summary: `Mål: ${raceLabel ? raceLabel.replace(/^løb:?\s*/i, '') : 'løbet'}`,
    description: [plan.summary, plan.title].filter(Boolean).join('\n'),
    date: plan.raceDate,
  };
  const others = plan.goals.map(
    (g): CalendarEvent => ({
      ...base,
      uid: `maal-${g.date}-${slug(g.title)}@${UID_DOMAIN}`,
      summary: `Mål: ${g.title}`,
      description: [g.note, plan.title].filter(Boolean).join('\n'),
      date: g.date,
    }),
  );
  return [race, ...others];
}

// ─── iCalendar ──────────────────────────────────────────────────────────────

function vevent(e: CalendarEvent): Component {
  const when: Prop[] = e.startTime
    ? [
        ['DTSTART', icalLocal(e.date, e.startTime), { TZID }],
        ['DURATION', `PT${e.durationMin}M`],
      ]
    : [
        ['DTSTART', icalDate(e.date), { VALUE: 'DATE' }],
        ['DTEND', icalDate(nextDay(e.date)), { VALUE: 'DATE' }],
      ];
  return {
    name: 'VEVENT',
    props: [
      ['UID', e.uid],
      ['DTSTAMP', icalUtc(e.lastModified)],
      ['LAST-MODIFIED', icalUtc(e.lastModified)],
      ['SEQUENCE', String(e.sequence)],
      ...when,
      ['SUMMARY', text(e.summary)],
      ['DESCRIPTION', text(e.description)],
      ...(e.url ? ([['URL', e.url, { VALUE: 'URI' }]] as Prop[]) : []),
      ['CATEGORIES', text(e.category)],
      // Heldagsevents blokerer ikke kalenderen (vises som "ledig").
      ['TRANSP', e.startTime ? 'OPAQUE' : 'TRANSPARENT'],
      ['STATUS', 'CONFIRMED'],
    ],
  };
}

const calendarProps = (desc: string): Prop[] => [
  ['VERSION', '2.0'],
  ['PRODID', '-//Traeningsnav//Kalenderfeed//DA'],
  ['CALSCALE', 'GREGORIAN'],
  ['X-WR-CALNAME', text('Træningsplan')],
  ['X-WR-CALDESC', text(desc)],
  ['X-WR-TIMEZONE', TZID],
  ['REFRESH-INTERVAL', 'PT6H', { VALUE: 'DURATION' }],
  ['X-PUBLISHED-TTL', 'PT6H'],
];

/** Feed uden events, til en atlet der endnu ikke har en plan. */
export function renderEmptyFeed(): string {
  return serialize({ name: 'VCALENDAR', props: calendarProps('Ingen plan endnu'), components: [copenhagenTimezone] });
}

/** Hele feedet som iCalendar-tekst. */
export function renderFeed(input: FeedInput): string {
  return serialize({
    name: 'VCALENDAR',
    props: calendarProps(`${input.plan.title} · planversion ${input.planVersion}`),
    components: [copenhagenTimezone, ...buildEvents(input).map(vevent)],
  });
}
