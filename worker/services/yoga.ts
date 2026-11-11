// Yogarutiner som planforslag: bygger (eller tager imod) en rutine, lægger den i planen som en
// mobilitetssession med "yoga", fordeler den på ugens dage og laver et almindeligt patch-forslag, som
// atleten godkender i appen. Mobilitetstestene bruges til at finde stramme områder og sider.
import type { JsonPatch } from '../../shared/jsonPatch';
import type { Plan, ScheduledSession, Session, Side, YogaArea, YogaRoutine } from '../../shared/plan.schema';
import { weekForDate } from '../../shared/resolve';
import { buildYogaRoutine, defaultYogaName, insightsFromTests, pickYogaDays, routineSeconds, type TestInsight } from '../../shared/yoga';
import { addDays, todayInCopenhagen } from './clock';
import { ValidationError } from './errors';
import { getActivePlan } from './plan';
import { createProposal } from './proposals';
import { getMobilityTrend } from './trends';

export interface YogaProposalInput {
  minutes?: number;
  areas: YogaArea[];
  timesPerWeek: number;
  days?: number[];
  fromWeek?: number;
  toWeek?: number;
  name?: string;
  sessionId?: string;
  /** En færdig rutine (Claude har selv valgt stillingerne). Ellers bygges den. */
  routine?: YogaRoutine;
  useTests: boolean;
  summary?: string;
  rationale: string;
}

/** Hvor tung en dag er i forvejen: styrke vejer mest, så yogaen helst lander på lette dage. */
const LOAD: Record<Session['kind'], number> = { styrke: 2, løb: 1, cardio: 1, mobilitet: 1 };

function newSessionId(plan: Plan): string {
  for (let i = 1; ; i++) {
    const id = i === 1 ? 'yoga' : `yoga-${i}`;
    if (!plan.sessions.some((s) => s.id === id)) return id;
  }
}

export async function proposeYogaRoutine(db: D1Database, athleteId: number, input: YogaProposalInput, now: Date) {
  const { plan } = await getActivePlan(db, athleteId);
  const today = todayInCopenhagen(now);

  // Mobilitetstestene: områder og stram side.
  let insights: TestInsight[] = [];
  if (input.useTests) {
    const trend = await getMobilityTrend(db, athleteId);
    insights = insightsFromTests(trend.map(({ test, points }) => ({ ...test, last: points.at(-1) })));
  }
  const areas = [...new Set([...input.areas, ...insights.map((i) => i.area)])];
  const tight: Partial<Record<YogaArea, Side>> = {};
  for (const i of insights) if (i.tightSide && !tight[i.area]) tight[i.area] = i.tightSide;

  if (!input.routine && !input.minutes) throw new ValidationError('Angiv minutter (eller en færdig liste af stillinger)');
  const routine = input.routine ?? buildYogaRoutine({ minutes: input.minutes!, areas, tight });
  const minutes = Math.round(routineSeconds(routine) / 60);

  // Sessionen: ny, eller en eksisterende yogasession der erstattes.
  const existingIndex = input.sessionId ? plan.sessions.findIndex((s) => s.id === input.sessionId) : -1;
  const existing = existingIndex >= 0 ? plan.sessions[existingIndex] : undefined;
  if (existing && existing.kind !== 'mobilitet') throw new ValidationError(`${existing.id} er en ${existing.kind}session; vælg et nyt sessionId`);
  if (existing && existing.kind === 'mobilitet' && !existing.yoga) throw new ValidationError(`${existing.id} er planens mobilitetsblok; vælg et nyt sessionId til yogaen`);
  const sessionId = input.sessionId ?? newSessionId(plan);
  const name = input.name ?? (existing?.name || defaultYogaName(areas));
  const session: Session = {
    id: sessionId,
    name,
    colorKey: 'mobility',
    kind: 'mobilitet',
    durationMin: { min: minutes, max: minutes },
    notes: insights.filter((i) => i.tightSide).map((i) => i.note),
    yoga: routine,
  };

  // Ugerne: fra denne uge (eller planens første, hvis den ikke er startet) til sidste uge.
  const current = weekForDate(plan, today) ?? (today < plan.startDate ? plan.weeks[0] : weekForDate(plan, addDays(today, 7)));
  const fromWeek = input.fromWeek ?? current?.weekNo;
  if (fromWeek === undefined) throw new ValidationError('Planen er slut. Angiv fraUge, eller lav en ny plan.');
  const toWeek = input.toWeek ?? Math.max(...plan.weeks.map((w) => w.weekNo));
  if (toWeek < fromWeek) throw new ValidationError(`tilUge (${toWeek}) ligger før fraUge (${fromWeek})`);
  const kind = (id: string) => plan.sessions.find((s) => s.id === id)?.kind;
  const days = input.days ? [...new Set(input.days)].sort() : undefined;
  const label = `${name} (${minutes} min)`;

  const patch: JsonPatch = [existing ? { op: 'replace', path: `/sessions/${existingIndex}`, value: session } : { op: 'add', path: '/sessions/-', value: session }];
  const schedule: { week: number; days: number[] }[] = [];
  plan.weeks.forEach((week, wi) => {
    if (week.weekNo < fromWeek || week.weekNo > toWeek) return;
    const others = week.sessions.filter((s) => s.sessionId !== sessionId);
    const picked = days ?? pickYogaDays({ sessions: others }, input.timesPerWeek, (id) => LOAD[kind(id) ?? 'mobilitet']);
    const added: ScheduledSession[] = picked.map((day) => ({ sessionId, day, label, optional: false }));
    // Sorteret efter dag (stabilt), så ugen læses naturligt.
    const sessions = [...others, ...added].map((s, i) => ({ s, i })).sort((a, b) => a.s.day - b.s.day || a.i - b.i).map((x) => x.s);
    patch.push({ op: 'replace', path: `/weeks/${wi}/sessions`, value: sessions });
    schedule.push({ week: week.weekNo, days: picked });
  });
  if (!schedule.length) throw new ValidationError(`Ingen uger i planen mellem uge ${fromWeek} og ${toWeek}`);

  const areaText = areas.length ? areas.join(', ') : 'hele kroppen';
  const perWeek = days?.length ?? input.timesPerWeek;
  const summary = input.summary ?? `${name}: ${minutes} min, ${perWeek}× om ugen fra uge ${fromWeek}`.slice(0, 200);
  const proposal = await createProposal(db, athleteId, { summary, rationale: input.rationale, patch }, now.toISOString());
  return { proposal, session, routine, minutes, areas: areaText, insights, schedule, fromWeek, toWeek };
}
