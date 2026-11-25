import { CaretLeft, CaretRight, Check, Circle } from '@phosphor-icons/react';
import { Link, useRoute, useSearch } from 'wouter';
import { countedSets } from '../../shared/history';
import { duringScore, morningScore, type PainLight } from '../../shared/pain';
import type { MobilityRound, Plan } from '../../shared/plan.schema';
import type { ExerciseNote, SetLog, Workout } from '../../shared/records.schema';
import { formatDose, formatIntensity, getExercise, resolveStrengthSession, weekForDate } from '../../shared/resolve';
import { SessionAction } from '../components/SessionAction';
import { useDay, type DayData } from '../data/calendar';
import { useWorstLights } from '../data/health';
import { useMonitors, usePlan } from '../data/plan';
import { useWeekWorkouts } from '../data/workouts';
import { formatShort, todayIso, weekday, WEEKDAYS } from '../lib/dates';
import { sessionDetail } from '../lib/sessions';
import { addDays, type DayEntry } from '../logic/calendar';
import { illustrationFor } from '../logic/illustrations';
import { parseLayout, orderSlots } from '../logic/layout';
import { summarizeSets } from '../logic/lastTime';
import { formatDecimal } from '../logic/numbers';
import { formatDuration, formatPace } from '../logic/pace';
import { ButtonLink } from '../ui/Button';
import { Figure } from '../ui/Figure';
import { IconTile } from '../ui/IconTile';
import { Card, InsetList, InsetRow } from '../ui/InsetList';
import { Muted, Screen } from '../ui/Screen';
import { StatusLight } from '../ui/StatusLight';
import { PlanStatus } from './PlanStatus';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ROUND_TITLE: Record<MobilityRound, string> = { morgen: 'Morgenrunde', aften: 'Aftenrunde' };

/** Et sikkert internt "tilbage"-link fra ?tilbage=, ellers kalenderen for dagens måned. */
function backFrom(search: URLSearchParams, date: string) {
  const href = search.get('tilbage');
  if (href?.startsWith('/') && !href.startsWith('//'))
    return { href, label: href.startsWith('/uge') ? 'Uge' : href.startsWith('/historik') ? 'Historik' : href === '/' ? 'I dag' : 'Tilbage' };
  return { href: `/kalender?m=${date.slice(0, 7)}`, label: 'Kalender' };
}

/** Træningens varighed i sekunder: logget tid, ellers fra start til slut. */
export function durationOf(w: Workout): number | null {
  if (w.duration_sec) return w.duration_sec;
  if (w.started_at && w.finished_at) return Math.max(0, Math.round((Date.parse(w.finished_at) - Date.parse(w.started_at)) / 1000));
  return null;
}

interface Logged {
  exerciseId: string;
  name: string;
  sets: SetLog[];
  note?: ExerciseNote;
}

/** Øvelserne logget i en træning, i dagens rækkefølge (planens pladser efter evt. flytning), ekstra øvelser til sidst. */
function loggedExercises(plan: Plan, entry: DayEntry, sets: SetLog[], notes: ExerciseNote[]): Logged[] {
  const w = entry.workout!;
  const own = sets.filter((s) => s.workout_uuid === w.uuid);
  const ids = [...new Set(own.map((s) => s.exercise_id))];
  const weekNo = w.week_no ?? entry.weekNo;
  const order: string[] = [];
  if (entry.session?.kind === 'styrke' && weekNo) {
    try {
      const slots = orderSlots(resolveStrengthSession(plan, entry.session.id, weekNo).slots, parseLayout(w.layout).order);
      for (const slot of slots)
        for (const ex of slot.exercises) {
          order.push(ex.exercise.id);
          if (ex.planned.alternative) order.push(ex.planned.alternative.exerciseId);
        }
    } catch {
      // Ugen findes ikke i planen længere: rækkefølgen som logget.
    }
  }
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  return ids
    .sort((a, b) => rank(a) - rank(b))
    .map((id) => ({
      exerciseId: id,
      name: getExercise(plan, id)?.name ?? id,
      sets: countedSets(own.filter((s) => s.exercise_id === id)),
      note: notes.find((n) => n.workout_uuid === w.uuid && n.exercise_id === id),
    }))
    .filter((e) => e.sets.length > 0);
}

function Thumb({ id, name }: { id: string; name: string }) {
  const ill = illustrationFor(id, name);
  return (
    <span className="w-14 shrink-0 rounded-[10px] bg-bg p-0.5">
      {ill ? <Figure illustration={ill} label="" className="block h-auto w-full" /> : <span className="block aspect-[5/4]" />}
    </span>
  );
}

/**
 * /dag/<dato>: alt om træningen på én dag. Planlagte sessioner med øvelser og dosering, lavede med
 * sæt, vægt, RPE og noter, løb, mobilitet, smerte og målinger.
 */
export function DayPage() {
  const [, params] = useRoute('/dag/:date');
  const date = params?.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayIso();
  const search = new URLSearchParams(useSearch());
  const { active, profile } = usePlan();
  const day = useDay(date);
  const lights = useWorstLights();
  const monitors = useMonitors();
  const week = active ? weekForDate(active.plan, date) : undefined;
  const weekWorkouts = useWeekWorkouts(week);
  if (!active) return <PlanStatus title="Dag" />;
  const plan = active.plan;
  const today = todayIso();
  const back = backFrom(search, date);
  const query = search.get('tilbage') ? `?tilbage=${encodeURIComponent(search.get('tilbage')!)}` : '';

  const nav = (
    <div className="flex gap-2">
      {[-1, 1].map((d) => (
        <Link key={d} href={`/dag/${addDays(date, d)}${query}`} replace aria-label={d < 0 ? 'Dagen før' : 'Dagen efter'} className="grid size-11 place-items-center rounded-full bg-fill text-ink">
          {d < 0 ? <CaretLeft size={18} weight="bold" aria-hidden="true" /> : <CaretRight size={18} weight="bold" aria-hidden="true" />}
        </Link>
      ))}
    </div>
  );

  const subtitle = [date === today ? 'I dag' : date.slice(0, 4) !== today.slice(0, 4) ? date.slice(0, 4) : null, week && `Uge ${week.weekNo} af ${plan.weeks.length} · ${week.phase}`]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen title={`${cap(WEEKDAYS[weekday(date)])} ${formatShort(date)}`} subtitle={subtitle || undefined} back={back} accessory={nav}>
      {!day ? <Muted>Henter …</Muted> : <DayContent plan={plan} date={date} today={today} day={day} lights={lights} monitors={monitors} tests={profile?.mobilityTests ?? []} week={week} weekWorkouts={weekWorkouts} />}
    </Screen>
  );
}

function DayContent({
  plan,
  date,
  today,
  day,
  lights,
  monitors,
  tests,
  week,
  weekWorkouts,
}: {
  plan: Plan;
  date: string;
  today: string;
  day: DayData;
  lights: ReturnType<typeof useWorstLights>;
  monitors: ReturnType<typeof useMonitors>;
  tests: NonNullable<ReturnType<typeof usePlan>['profile']>['mobilityTests'];
  week: ReturnType<typeof weekForDate>;
  weekWorkouts: Workout[] | undefined;
}) {
  const done = day.entries.filter((e) => e.workout && (e.state === 'lavet' || e.state === 'i-gang'));
  const doneUuids = new Set(done.map((e) => e.workout!.uuid));
  const counted = [...new Set(day.sets.map((s) => `${s.workout_uuid}|${s.exercise_id}`))]
    .filter((k) => doneUuids.has(k.split('|')[0]))
    .flatMap((k) => countedSets(day.sets.filter((s) => `${s.workout_uuid}|${s.exercise_id}` === k)));
  const volume = counted.reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);
  const km = done.reduce((sum, e) => sum + (e.workout!.type === 'løb' ? (e.workout!.distance_km ?? 0) : 0), 0);
  const seconds = done.reduce((sum, e) => sum + (durationOf(e.workout!) ?? 0), 0);
  const stats = [
    counted.length > 0 && { label: 'Sæt', value: String(counted.length) },
    volume > 0 && { label: 'Volumen', value: formatDecimal(Math.round(volume)), unit: 'kg' },
    km > 0 && { label: 'Løb', value: formatDecimal(Math.round(km * 100) / 100), unit: 'km' },
    seconds > 0 && { label: 'Tid', value: formatDuration(seconds) },
  ].filter((s): s is { label: string; value: string; unit?: string } => !!s);

  const rounds = plan.mobility?.schedule ?? [];
  const inPlan = !!week;
  const showRounds = !!plan.mobility && rounds.length > 0 && inPlan && (date <= today || day.roundChecks.length > 0);
  const morning = day.pain.filter((s) => s.kind === 'morgen' && s.date === date);
  const nothing = day.entries.length === 0 && !day.roundChecks.some((c) => c.done) && morning.length === 0 && day.measurements.length === 0;

  return (
    <>
      {stats.length > 0 && (
        <Card className="mb-3">
          <dl className={`grid gap-3 ${stats.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {stats.slice(0, 3).map((s) => (
              <div key={s.label}>
                <dt className="text-footnote text-ink-2">{s.label}</dt>
                <dd className="num text-title">
                  {s.value}
                  {s.unit && <span className="ml-1 text-secondary font-semibold">{s.unit}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {nothing && (
        <Card className="mb-3">
          <h2 className="text-title">{inPlan ? 'Hviledag' : 'Ingen træning'}</h2>
          <Muted className="mt-0.5">{inPlan ? 'Intet planlagt eller logget denne dag.' : 'Dagen ligger uden for planen, og intet er logget.'}</Muted>
        </Card>
      )}

      {day.entries.map((e) => (
        <EntryCard key={e.key} plan={plan} entry={e} day={day} light={e.workout ? lights.get(e.workout.uuid)?.light : undefined} monitors={monitors} week={week} weekWorkouts={weekWorkouts} />
      ))}

      {showRounds && (
        <Card className="mb-3 p-0">
          <div className="flex items-center gap-3 px-4 pt-4 pb-2">
            <IconTile category="mobility" />
            <h2 className="min-w-0 flex-1 text-headline">{plan.mobility!.name}</h2>
          </div>
          {rounds.map((round) => {
            const checked = new Set(day.roundChecks.filter((c) => c.round === round && c.done).map((c) => c.item_id));
            const items = plan.mobility!.items;
            const n = items.filter((i) => checked.has(i.id)).length;
            return (
              <div key={round} className="border-t-[0.5px] border-separator px-4 py-3 first:border-t-0">
                <p className="num mb-1.5 text-secondary">
                  <span className="font-semibold">{ROUND_TITLE[round]}</span>
                  <span className="text-ink-2">
                    {' '}
                    · {n} af {items.length} punkter
                  </span>
                </p>
                <ul className="grid gap-1">
                  {items.map((i) => (
                    <li key={i.id} className={`flex items-start gap-2 text-footnote ${checked.has(i.id) ? 'text-ink' : 'text-ink-2'}`}>
                      {checked.has(i.id) ? (
                        <Check size={14} weight="bold" className="mt-0.5 shrink-0 text-status-green" aria-label="Lavet" />
                      ) : (
                        <Circle size={14} className="mt-0.5 shrink-0 text-ink-3" aria-label="Ikke lavet" />
                      )}
                      <span>
                        {i.name}
                        {i.dose && <span className="text-ink-2"> · {i.dose}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </Card>
      )}

      {(morning.length > 0 || day.measurements.length > 0) && (
        <Card className="mb-3">
          <h2 className="mb-2 text-headline">Smerte og målinger</h2>
          <ul className="grid gap-1.5 text-secondary">
            {morning.map((s) => (
              <li key={s.uuid} className="num">
                <span className="text-ink-2">Morgen · </span>
                {monitors.find((m) => m.id === s.monitor_id)?.label ?? 'Smerte'}: {s.score}/10
              </li>
            ))}
            {day.measurements.map((m) => {
              const test = tests.find((t) => t.id === m.test_id);
              const unit = test?.unit ? ` ${test.unit}` : '';
              const value =
                m.value_right != null || m.value_left != null
                  ? `højre ${formatDecimal(m.value_right)}${unit} · venstre ${formatDecimal(m.value_left)}${unit}`
                  : `${formatDecimal(m.value)}${unit}`;
              return (
                <li key={m.uuid} className="num">
                  {test?.name ?? 'Måling'}: {value}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {week?.focus && <p className="mt-6 px-1 text-footnote text-ink-2">Ugens fokus: {week.focus}</p>}
    </>
  );
}

const STATE_LINE: Record<DayEntry['state'], string> = { lavet: 'Lavet', 'i-gang': 'I gang', planlagt: 'Planlagt', misset: 'Misset', 'sprunget-over': 'Sprunget over' };

function EntryCard({
  plan,
  entry,
  day,
  light,
  monitors,
  week,
  weekWorkouts,
}: {
  plan: Plan;
  entry: DayEntry;
  day: DayData;
  light: PainLight | undefined;
  monitors: ReturnType<typeof useMonitors>;
  week: ReturnType<typeof weekForDate>;
  weekWorkouts: Workout[] | undefined;
}) {
  const w = entry.workout;
  const session = entry.session;
  const weekNo = w?.week_no ?? entry.weekNo;
  const duration = w ? durationOf(w) : null;
  const scheduled = week && entry.plannedDay ? week.sessions.find((s) => s.sessionId === entry.session?.id && s.day === entry.plannedDay) : undefined;
  const status = [
    entry.state === 'sprunget-over' && w?.skip_reason ? `Sprunget over · ${w.skip_reason}` : STATE_LINE[entry.state],
    entry.state === 'lavet' && duration ? formatDuration(duration) : null,
    w?.rpe != null ? `RPE ${formatDecimal(w.rpe)}` : null,
    entry.plannedDate && entry.plannedDate !== entry.date ? `planlagt ${WEEKDAYS[weekday(entry.plannedDate)]} ${formatShort(entry.plannedDate)}` : null,
    entry.movedFrom && !w ? `flyttet fra ${WEEKDAYS[entry.movedFrom]}` : null,
    entry.optional ? 'valgfri' : null,
  ].filter(Boolean);

  const logged = w && session?.kind !== 'løb' && session?.kind !== 'cardio' ? loggedExercises(plan, entry, day.sets, day.notes) : [];
  const planned =
    !w && session?.kind === 'styrke' && weekNo
      ? (() => {
          try {
            return resolveStrengthSession(plan, session.id, weekNo).slots.flatMap((s) => s.exercises);
          } catch {
            return [];
          }
        })()
      : [];
  const mobilityDone = w ? day.mobilityChecks.filter((c) => c.workout_uuid === w.uuid && c.done).length : 0;
  const isRun = w ? w.type === 'løb' || w.type === 'cardio' : session?.kind === 'løb' || session?.kind === 'cardio';
  const pace = w && formatPace(w.duration_sec, w.distance_km);
  const canStart = !w && session && week && entry.weekNo === week.weekNo && entry.plannedDay && session.kind !== 'mobilitet';

  return (
    <Card className="mb-3 p-0">
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <IconTile category={entry.category} />
        <div className="min-w-0 flex-1">
          <h2 className={`text-headline ${entry.state === 'misset' || entry.state === 'sprunget-over' ? 'text-ink-2' : ''}`}>{entry.title}</h2>
          <p className="num mt-0.5 text-secondary text-ink-2">
            {entry.state === 'lavet' && <Check size={14} weight="bold" className="mr-1 inline align-[-1px] text-status-green" aria-hidden="true" />}
            {status.join(' · ')}
          </p>
          {!w && scheduled && session && sessionDetail(scheduled, session) && <p className="num text-footnote text-ink-2">{sessionDetail(scheduled, session)}</p>}
          {w && monitors.length > 0 && w.type !== 'mobilitet' && (
            <div className="mt-1.5 grid gap-0.5">
              {monitors.map((m) => {
                const under = duringScore(day.pain, w.uuid, m.id)?.score;
                const next = morningScore(day.pain, w, m.id)?.score;
                if (under == null) return null;
                return (
                  <p key={m.id} className="num text-footnote text-ink-2">
                    {m.label}: {under}/10 under{next != null ? `, ${next}/10 morgenen efter` : ''}
                  </p>
                );
              })}
              {light && <StatusLight small light={light} />}
            </div>
          )}
        </div>
        {w && entry.state !== 'sprunget-over' ? (
          <ButtonLink small href={`/session/${w.uuid}`} className="shrink-0">
            Åbn
          </ButtonLink>
        ) : canStart ? (
          <SessionAction session={session} week={week} plannedDay={entry.plannedDay!} workouts={weekWorkouts} />
        ) : null}
      </div>

      {isRun && w && (w.distance_km != null || w.duration_sec != null || w.avg_hr != null) && (
        <dl className="grid grid-cols-4 gap-2 border-t-[0.5px] border-separator px-4 py-3">
          {[
            ['Distance', w.distance_km != null ? `${formatDecimal(w.distance_km)} km` : '–'],
            ['Tid', w.duration_sec ? formatDuration(w.duration_sec) : '–'],
            ['Tempo', pace ? `${pace} /km` : '–'],
            ['Puls', w.avg_hr ? `${w.avg_hr}` : '–'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-footnote text-ink-2">{k}</dt>
              <dd className="num text-secondary font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {isRun && !w && session && (session.kind === 'løb' || session.kind === 'cardio') && (
        <div className="border-t-[0.5px] border-separator px-4 py-3 text-footnote text-ink-2">
          <p>
            <span className="font-semibold text-ink">Hovedsæt:</span> {session.mainSet}
          </p>
          {session.targetPace && (
            <p>
              <span className="font-semibold text-ink">Fart:</span> {session.targetPace}
            </p>
          )}
        </div>
      )}

      {mobilityDone > 0 && plan.mobility && (
        <p className="num border-t-[0.5px] border-separator px-4 py-3 text-secondary text-ink-2">
          Mobilitet: {mobilityDone} af {plan.mobility.items.length} punkter
        </p>
      )}

      {logged.length > 0 && (
        <InsetList inset={84} className="rounded-none border-t-[0.5px] border-separator" label={`Øvelser i ${entry.title}`}>
          {logged.map((e) => {
            const kind = getExercise(plan, e.exerciseId)?.kind ?? 'weight_reps';
            return (
              <InsetRow key={e.exerciseId} href={`/historik/oevelse/${e.exerciseId}`} className="items-start!">
                <Thumb id={e.exerciseId} name={e.name} />
                <span className="min-w-0 flex-1">
                  <span className="block text-row">{e.name}</span>
                  <span className="num block text-secondary text-ink-2">
                    {e.note?.variant && `${e.note.variant}: `}
                    {summarizeSets(e.sets, kind)}
                    {e.note?.rpe != null && `, RPE ${formatDecimal(e.note.rpe)}`}
                  </span>
                  {e.note?.note && <span className="block text-footnote text-ink-2">“{e.note.note}”</span>}
                </span>
              </InsetRow>
            );
          })}
        </InsetList>
      )}

      {planned.length > 0 && (
        <InsetList inset={84} className="rounded-none border-t-[0.5px] border-separator" label={`Øvelser i ${entry.title}`}>
          {planned.map((ex, i) => (
            <InsetRow key={`${ex.exercise.id}-${i}`} href={`/historik/oevelse/${ex.exercise.id}`} className="items-start!">
              <Thumb id={ex.exercise.id} name={ex.exercise.name} />
              <span className="min-w-0 flex-1">
                <span className="block text-row">{ex.label}</span>
                <span className="num block text-secondary text-ink-2">
                  {[formatDose(ex.exercise, ex.planned.dose), formatIntensity(ex.planned.dose)].filter(Boolean).join(' · ')}
                </span>
              </span>
            </InsetRow>
          ))}
        </InsetList>
      )}

      {w?.note && <p className="border-t-[0.5px] border-separator px-4 py-3 text-secondary">“{w.note}”</p>}
    </Card>
  );
}
