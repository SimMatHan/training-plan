import { useState } from 'react';
import { Link, useSearch } from 'wouter';
import type { WeeklySummary } from '../../shared/history';
import type { Plan } from '../../shared/plan.schema';
import type { Proposal } from '../../shared/proposals';
import { dateOfDay, weekForDate } from '../../shared/resolve';
import { AddActivityButton } from '../components/AddActivitySheet';
import { AthletePicker, useViewedAthlete } from '../components/AthletePicker';
import { CoachNotes } from '../components/CoachNotes';
import { GateBox } from '../components/GateBox';
import { Screen } from '../components/Screen';
import { WeekSessions } from '../components/WeekSessions';
import { useCoachNotes } from '../data/notes';
import { usePlan, type ActivePlan } from '../data/plan';
import { useRemote } from '../data/remote';
import { formatShort, todayIso } from '../lib/dates';
import { WeekCard } from './HistoryPage';
import { PlanStatus } from './PlanStatus';
import { ReadOnlyNote } from './ProposalPage';

const currentWeek = (plan: Plan, today: string) => weekForDate(plan, today)?.weekNo ?? (today < plan.startDate ? 1 : plan.weeks.length);

export function WeekPage() {
  const search = new URLSearchParams(useSearch());
  const viewed = useViewedAthlete(search.get('atlet'));
  // ?uge=<n> fra et kalenderlink åbner den uge.
  const linked = Number(search.get('uge')) || undefined;
  return viewed.own ? <OwnWeek linked={linked} /> : <CoachWeek slug={viewed.slug} name={viewed.name} />;
}

function WeekNav({ plan, index, onStep }: { plan: Plan; index: number; onStep: (d: number) => void }) {
  return (
    <div className="mb-4 flex gap-2">
      <button type="button" onClick={() => onStep(-1)} disabled={index === 0} className="min-h-12 flex-1 rounded-lg border border-line font-medium disabled:opacity-30">
        Forrige uge
      </button>
      <button
        type="button"
        onClick={() => onStep(1)}
        disabled={index === plan.weeks.length - 1}
        className="min-h-12 flex-1 rounded-lg border border-line font-medium disabled:opacity-30"
      >
        Næste uge
      </button>
    </div>
  );
}

function OwnWeek({ linked }: { linked: number | undefined }) {
  const { active, slug } = usePlan();
  const today = todayIso();
  const plan = active?.plan;
  const current = plan ? currentWeek(plan, today) : 1;
  const [weekNo, setWeekNo] = useState<number | undefined>(linked);
  const shown = plan && weekNo && plan.weeks.some((w) => w.weekNo === weekNo) ? weekNo : current;
  const notes = useCoachNotes(shown);
  if (!plan) return <PlanStatus title="Uge" picker />;

  const index = plan.weeks.findIndex((w) => w.weekNo === shown);
  const week = plan.weeks[index];
  const step = (d: number) => setWeekNo(plan.weeks[index + d]?.weekNo ?? shown);

  return (
    <Screen title={`Uge ${week.weekNo}`} eyebrow={`${formatShort(week.startDate)}–${formatShort(dateOfDay(week, 7))} · ${week.phase}`}>
      <AthletePicker value={slug} />
      <WeekNav plan={plan} index={index} onStep={step} />
      {week.focus && <p className="mb-3 text-sm text-muted">{week.focus}</p>}
      {week.kmLabel && (
        <p className="mb-3 text-sm text-muted">
          Km i ugen: <span className="num">{week.kmLabel}</span>
        </p>
      )}
      <CoachNotes notes={notes} plan={plan} />
      <WeekSessions plan={plan} week={week} today={today} />
      <AddActivityButton />
      <div className="mt-6">
        <GateBox plan={plan} week={week} />
      </div>
    </Screen>
  );
}

/** Trænervisning: en anden atlets uge, hentet fra serveren og skrivebeskyttet. */
function CoachWeek({ slug, name }: { slug: string; name: string }) {
  const remote = useRemote<ActivePlan | null>(slug, '/plan/active');
  const proposals = useRemote<Proposal[]>(slug, '/proposals?status=afventer');
  const plan = remote.data?.plan;
  const [weekNo, setWeekNo] = useState<number>();
  const shown = plan ? (weekNo && plan.weeks.some((w) => w.weekNo === weekNo) ? weekNo : currentWeek(plan, todayIso())) : undefined;
  const summary = useRemote<WeeklySummary>(slug, shown ? `/history/weeks/${shown}` : null);
  const pending = proposals.data?.length ?? 0;

  const header = (
    <>
      <AthletePicker value={slug} />
      <ReadOnlyNote name={name} />
      <Link href={`/forslag?atlet=${slug}`} className="mb-4 flex min-h-12 items-center justify-between rounded-lg border border-line px-4 font-medium">
        <span>Forslag fra Claude{pending > 0 && ` · ${pending} venter`}</span>
        <span aria-hidden="true" className="text-muted">
          ›
        </span>
      </Link>
    </>
  );

  if (remote.error) return <Screen title="Uge">{header}<p className="text-a-ink">{remote.error}</p></Screen>;
  if (remote.loading) return <Screen title="Uge">{header}<p className="text-muted">Henter …</p></Screen>;
  if (!plan || !shown)
    return (
      <Screen title="Uge">
        {header}
        <p className="text-muted">{name} har ingen plan endnu.</p>
      </Screen>
    );

  const index = plan.weeks.findIndex((w) => w.weekNo === shown);
  const week = plan.weeks[index];
  return (
    <Screen title={`Uge ${week.weekNo}`} eyebrow={`${name} · ${formatShort(week.startDate)}–${formatShort(dateOfDay(week, 7))} · ${week.phase}`}>
      {header}
      <WeekNav plan={plan} index={index} onStep={(d) => setWeekNo(plan.weeks[index + d]?.weekNo ?? shown)} />
      {week.focus && <p className="mb-3 text-sm text-muted">{week.focus}</p>}
      {summary.error && <p className="text-a-ink">{summary.error}</p>}
      {summary.data ? (
        <ul>
          <WeekCard key={week.weekNo} week={summary.data} isCurrent plan={plan} readOnly />
        </ul>
      ) : (
        !summary.error && <p className="text-muted">Henter …</p>
      )}
    </Screen>
  );
}
