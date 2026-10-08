import { useEffect, useState } from 'react';
import { Link, useSearch } from 'wouter';
import type { Plan } from '../../shared/plan.schema';
import { getSession, weekForDate } from '../../shared/resolve';
import type { WeeklySummary } from '../../shared/history';
import { AthletePicker, useViewedAthlete } from '../components/AthletePicker';
import { useExerciseOverview, useWeeklySummaries, type ExerciseOverview } from '../data/history';
import { usePlan, type ActivePlan } from '../data/plan';
import { useRemote } from '../data/remote';
import { athleteApi } from '../lib/api';
import { ReadOnlyNote } from './ProposalPage';
import { formatShort, todayIso, weekday, WEEKDAYS_SHORT } from '../lib/dates';
import { sessionTitle } from '../lib/sessions';
import { dayState } from '../logic/progress';
import { formatDecimal } from '../logic/numbers';
import { lastResult } from '../components/TodayCard';
import { formatDuration } from '../logic/pace';
import { exerciseCategory } from '../logic/category';
import { TILE_INSET, ExerciseRow } from '../ui/ExerciseRow';
import { Card, InsetList } from '../ui/InsetList';
import { ErrorText, Muted, Screen } from '../ui/Screen';
import { Segmented } from '../ui/Segmented';
import { StatusDot, StatusLight } from '../ui/StatusLight';
import { CaretDown, Check } from '@phosphor-icons/react';
import { PlanStatus } from './PlanStatus';

type Tab = 'oevelser' | 'uger';

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const TAB_KEY = 'traeningsnav.historyTab';

function readTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'uger' ? 'uger' : 'oevelser';
  } catch {
    return 'oevelser';
  }
}

export function HistoryPage() {
  const { active } = usePlan();
  const viewed = useViewedAthlete(new URLSearchParams(useSearch()).get('atlet'));
  const [tab, setTab] = useState<Tab>(readTab);
  if (viewed.own && !active) return <PlanStatus title="Historik" picker />;

  const choose = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // Ikke kritisk.
    }
  };

  return (
    <Screen title="Historik">
      <AthletePicker value={viewed.slug} />
      {!viewed.own && <ReadOnlyNote name={viewed.name} />}
      <Segmented
        className="mb-6"
        label="Vis historik pr."
        value={tab}
        onChange={choose}
        options={[
          { value: 'oevelser', label: 'Øvelser' },
          { value: 'uger', label: 'Uger' },
        ]}
      />
      {viewed.own ? (
        tab === 'oevelser' ? (
          <OwnExercises />
        ) : (
          <WeekList />
        )
      ) : (
        <CoachHistory slug={viewed.slug} tab={tab} />
      )}
    </Screen>
  );
}

function OwnExercises() {
  const { active } = usePlan();
  const overview = useExerciseOverview();
  if (!overview || !active) return <Muted>Henter …</Muted>;
  return <ExerciseList overview={overview} plan={active.plan} />;
}

/** Øvelser med historik. `query` sendes med til detaljesiden (trænervisning: ?atlet=<slug>). */
function ExerciseList({ overview, plan, query = '' }: { overview: ExerciseOverview[]; plan: Plan | undefined; query?: string }) {
  if (overview.length === 0) return <Muted>Ingen øvelser logget endnu.</Muted>;

  return (
    <InsetList inset={TILE_INSET}>
      {overview.map((o) => {
        const ex = plan?.exercises.find((e) => e.id === o.exerciseId);
        const r = lastResult(o.last, ex?.kind);
        return (
          <ExerciseRow
            key={o.exerciseId}
            category={exerciseCategory(plan, o.exerciseId)}
            name={ex?.name ?? o.exerciseId}
            detail={`${o.times} ${o.times === 1 ? 'gang' : 'gange'} · sidst ${formatShort(o.last.date)}`}
            value={r ? `${r.value} ${r.unit}` : undefined}
            sub={r?.sub}
            href={`/historik/oevelse/${o.exerciseId}${query}`}
          />
        );
      })}
    </InsetList>
  );
}

function WeekList() {
  const { active } = usePlan();
  const plan = active?.plan;
  const today = todayIso();
  const current = plan ? (weekForDate(plan, today)?.weekNo ?? (today < plan.startDate ? 0 : plan.weeks.length)) : 0;
  const summaries = useWeeklySummaries(plan, current);
  if (!summaries) return <Muted>Henter …</Muted>;
  if (summaries.length === 0) return <Muted>Planen er ikke startet endnu.</Muted>;
  return (
    <ul className="flex flex-col gap-3">
      {summaries.map((w) => (
        <WeekCard key={w.weekNo} week={w} isCurrent={w.weekNo === current} plan={plan!} />
      ))}
    </ul>
  );
}

/** Trænervisning: en anden atlets historik, hentet fra serveren og skrivebeskyttet. */
function CoachHistory({ slug, tab }: { slug: string; tab: Tab }) {
  const plan = useRemote<ActivePlan | null>(slug, '/plan/active');
  const overview = useRemote<ExerciseOverview[]>(slug, tab === 'oevelser' ? '/history/exercises' : null);
  const [weeks, setWeeks] = useState<WeeklySummary[]>();
  const p = plan.data?.plan;
  const today = todayIso();
  const current = p ? (weekForDate(p, today)?.weekNo ?? (today < p.startDate ? 0 : p.weeks.length)) : 0;
  useEffect(() => {
    if (tab !== 'uger' || !p) return;
    let cancelled = false;
    const nos = p.weeks.filter((w) => w.weekNo <= current).map((w) => w.weekNo);
    Promise.all(nos.map((n) => athleteApi<WeeklySummary>(slug, `/history/weeks/${n}`))).then(
      (list) => !cancelled && setWeeks(list.reverse()),
      () => !cancelled && setWeeks([]),
    );
    return () => {
      cancelled = true;
    };
  }, [slug, tab, p, current]);

  if (plan.error || overview.error) return <ErrorText>{plan.error ?? overview.error}</ErrorText>;
  if (plan.loading) return <Muted>Henter …</Muted>;
  if (tab === 'oevelser') return overview.data ? <ExerciseList overview={overview.data} plan={p} query={`?atlet=${slug}`} /> : <Muted>Henter …</Muted>;
  if (!p) return <Muted>Ingen plan endnu.</Muted>;
  if (!weeks) return <Muted>Henter …</Muted>;
  if (weeks.length === 0) return <Muted>Planen er ikke startet endnu.</Muted>;
  return (
    <ul className="flex flex-col gap-3">
      {weeks.map((w) => (
        <WeekCard key={w.weekNo} week={w} isCurrent={w.weekNo === current} plan={p} readOnly />
      ))}
    </ul>
  );
}

/** Én uges opsummering. `readOnly` (trænervisning): ingen links til atletens træninger, som kun findes på hendes telefon. */
export function WeekCard({ week, isCurrent, plan, readOnly = false }: { week: WeeklySummary; isCurrent: boolean; plan: Plan; readOnly?: boolean }) {
  const [open, setOpen] = useState(isCurrent);
  const title = (id: string, fallback: string) => {
    const s = getSession(plan, id);
    return s ? sessionTitle(s) : fallback;
  };
  const link = (href: string, text: string) =>
    readOnly ? (
      text
    ) : (
      <Link href={href} className="underline decoration-separator underline-offset-4">
        {text}
      </Link>
    );
  return (
    <li>
      <Card className="p-0">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left">
          <span className="min-w-0 flex-1">
            <span className="block text-headline">
              Uge {week.weekNo}
              <span className="font-normal text-ink-2">
                {' '}
                · {formatShort(week.startDate)}–{formatShort(week.endDate)}
              </span>
            </span>
            <span className="num block text-secondary text-ink-2">
              {week.done}/{week.planned} sessioner{week.skipped > 0 && ` · ${week.skipped} sprunget over`}
              {week.runKm > 0 && ` · ${formatDecimal(week.runKm)} km løb`}
              {week.mobilityDays > 0 && ` · mobilitet ${week.mobilityDays} ${week.mobilityDays === 1 ? 'dag' : 'dage'}`}
            </span>
          </span>
          {week.lights.length > 0 && (
            <span className="flex gap-1" aria-label={`Trafiklys: ${week.lights.join(', ')}`}>
              {week.lights.map((l, i) => (
                <StatusDot key={i} light={l} />
              ))}
            </span>
          )}
          <CaretDown size={16} weight="bold" className={`shrink-0 text-ink-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {open && (
          <div className="border-t-[0.5px] border-separator px-4 pt-1 pb-3">
            <ul className="inset-list">
              {week.sessions.map((s) => (
                <li key={s.sessionId} className="flex min-h-11 items-center gap-3 text-secondary">
                  <span className="w-9 text-ink-2">{WEEKDAYS_SHORT[s.day]}</span>
                  <span className="min-w-0 flex-1">
                    {s.workoutUuid ? link(`/session/${s.workoutUuid}`, title(s.sessionId, s.name)) : title(s.sessionId, s.name)}
                    {s.optional && <span className="text-ink-2"> · valgfri</span>}
                    {s.day !== s.plannedDay && <span className="text-ink-2"> · flyttet fra {WEEKDAYS_SHORT[s.plannedDay]}</span>}
                  </span>
                  {s.light && <StatusLight light={s.light} />}
                  <span className={`inline-flex items-center gap-1 ${s.status === 'lavet' ? 'font-medium' : 'text-ink-2'}`}>
                    {s.status === 'lavet' && <Check size={14} weight="bold" className="text-status-green" aria-hidden="true" />}
                    {s.status === 'lavet'
                      ? 'Lavet'
                      : s.status === 'sprunget-over'
                        ? `Sprunget over${s.skipReason ? ` · ${s.skipReason}` : ''}`
                        : s.status === 'i-gang'
                          ? 'I gang'
                          : !s.optional && dayState(addDays(week.startDate, s.day - 1), todayIso()) === 'past'
                            ? 'Misset'
                            : '–'}
                  </span>
                </li>
              ))}
            </ul>
            {week.extras.length > 0 && (
              <>
                <h3 className="mt-3 mb-1 text-footnote font-semibold text-ink-2">Andre aktiviteter</h3>
                <ul className="inset-list">
                  {week.extras.map((x) => (
                    <li key={x.workoutUuid} className="flex min-h-11 items-center gap-3 text-secondary">
                      <span className="w-9 text-ink-2">{WEEKDAYS_SHORT[weekday(x.date)]}</span>
                      <span className="min-w-0 flex-1">
                        {link(`/session/${x.workoutUuid}`, x.name)}
                        {x.durationSec != null && <span className="num text-ink-2"> · {formatDuration(x.durationSec)}</span>}
                      </span>
                      {x.light && <StatusLight light={x.light} />}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {week.volume.length > 0 && (
              <>
                <h3 className="mt-3 mb-1 text-footnote font-semibold text-ink-2">Volumen pr. øvelse</h3>
                <table className="num w-full text-footnote">
                  <tbody>
                    {week.volume.map((v) => (
                      <tr key={v.exerciseId}>
                        <td className="py-0.5 pr-2">{v.name}</td>
                        <td className="py-0.5 text-right text-ink-2">
                          {v.sets} sæt · {v.reps} reps
                        </td>
                        <td className="py-0.5 pl-2 text-right">{v.volumeKg > 0 ? `${formatDecimal(v.volumeKg)} kg` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}
