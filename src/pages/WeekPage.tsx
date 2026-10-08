import { useState } from 'react';
import { useSearch } from 'wouter';
import type { WeeklySummary } from '../../shared/history';
import type { Plan } from '../../shared/plan.schema';
import type { Proposal } from '../../shared/proposals';
import { dateOfDay, weekForDate } from '../../shared/resolve';
import { AddActivityButton } from '../components/AddActivitySheet';
import { AthletePicker, useViewedAthlete } from '../components/AthletePicker';
import { CoachNotes } from '../components/CoachNotes';
import { GateBox } from '../components/GateBox';
import { WeekSessions } from '../components/WeekSessions';
import { useWorstLights } from '../data/health';
import { useWeekOverrides } from '../data/schedule';
import { statusOf, useWeekWorkouts } from '../data/workouts';
import { effectiveSessions } from '../../shared/schedule';
import { formatDecimal } from '../logic/numbers';
import type { PainLight } from '../../shared/pain';
import type { Week } from '../../shared/plan.schema';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { ButtonLink } from '../ui/Button';
import { Card } from '../ui/InsetList';
import { Ring } from '../ui/Ring';
import { ErrorText, Muted, Screen } from '../ui/Screen';
import { LIGHT_TEXT, StatusDot } from '../ui/StatusLight';
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

/** Forrige/næste uge som to runde knapper ved titlen. */
function WeekNav({ plan, index, onStep }: { plan: Plan; index: number; onStep: (d: number) => void }) {
  const btn = 'grid size-11 place-items-center rounded-full bg-surface-2 text-ink disabled:opacity-30';
  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => onStep(-1)} disabled={index === 0} aria-label="Forrige uge" className={btn}>
        <CaretLeft size={18} weight="bold" aria-hidden="true" />
      </button>
      <button type="button" onClick={() => onStep(1)} disabled={index === plan.weeks.length - 1} aria-label="Næste uge" className={btn}>
        <CaretRight size={18} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}

const subtitle = (week: Week) => `${formatShort(week.startDate)}–${formatShort(dateOfDay(week, 7))} · ${week.phase}`;

/** Hvordan går ugen? Sessioner lavet ud af planlagte i en ring, løbe-km og lysken. */
function WeekProgress({ week }: { week: Week }) {
  const workouts = useWeekWorkouts(week.weekNo);
  const overrides = useWeekOverrides(week.weekNo);
  const groin = useWorstLights();
  if (!workouts) return null;
  const planned = effectiveSessions(week, overrides ?? []).filter((s) => !s.optional);
  const done = planned.filter((s) => statusOf(workouts, s.sessionId).status === 'lavet').length;
  const km = workouts.filter((w) => w.type === 'løb').reduce((sum, w) => sum + (w.distance_km ?? 0), 0);
  const lights = workouts.map((w) => groin.get(w.uuid)?.light).filter((l): l is PainLight => !!l);
  const counts = (['grøn', 'gul', 'rød'] as const).map((l) => [l, lights.filter((x) => x === l).length] as const).filter(([, n]) => n > 0);

  return (
    <Card className="mb-8 flex items-center gap-5">
      <Ring progress={planned.length ? done / planned.length : 0} size={112} stroke={11} label={`${done} af ${planned.length} sessioner lavet`}>
        <span>
          <span className="num block text-title">
            {done}/{planned.length}
          </span>
          <span className="block text-footnote text-ink-2">sessioner</span>
        </span>
      </Ring>
      <dl className="min-w-0 flex-1 space-y-3">
        <div>
          <dt className="text-footnote text-ink-2">Løb</dt>
          <dd className="num text-headline">
            {formatDecimal(Math.round(km * 10) / 10)} km{week.kmLabel && <span className="font-normal text-ink-2"> af {week.kmLabel}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-footnote text-ink-2">Lysken</dt>
          <dd className="text-secondary">
            {counts.length === 0 ? (
              <span className="text-ink-2">Ingen målinger endnu</span>
            ) : (
              counts.map(([l, n]) => (
                <span key={l} className="mr-3 inline-flex items-center gap-1.5">
                  <StatusDot light={l} />
                  <span className="num">
                    {n} {LIGHT_TEXT[l].toLowerCase()}
                  </span>
                </span>
              ))
            )}
          </dd>
        </div>
      </dl>
    </Card>
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
    <Screen title={`Uge ${week.weekNo}`} subtitle={subtitle(week)} accessory={<WeekNav plan={plan} index={index} onStep={step} />}>
      <AthletePicker value={slug} />
      <WeekProgress week={week} />
      {week.focus && <Muted className="mb-3 px-1">{week.focus}</Muted>}
      <CoachNotes notes={notes} plan={plan} />
      <WeekSessions plan={plan} week={week} today={today} />
      <AddActivityButton />
      <div className="mt-8">
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
      <ButtonLink href={`/forslag?atlet=${slug}`} className="mb-6">
        Forslag fra Claude{pending > 0 && ` · ${pending} venter`}
      </ButtonLink>
    </>
  );

  if (remote.error) return <Screen title="Uge">{header}<ErrorText>{remote.error}</ErrorText></Screen>;
  if (remote.loading) return <Screen title="Uge">{header}<Muted>Henter …</Muted></Screen>;
  if (!plan || !shown)
    return (
      <Screen title="Uge">
        {header}
        <Muted>{name} har ingen plan endnu.</Muted>
      </Screen>
    );

  const index = plan.weeks.findIndex((w) => w.weekNo === shown);
  const week = plan.weeks[index];
  return (
    <Screen
      title={`Uge ${week.weekNo}`}
      subtitle={`${name} · ${subtitle(week)}`}
      accessory={<WeekNav plan={plan} index={index} onStep={(d) => setWeekNo(plan.weeks[index + d]?.weekNo ?? shown)} />}
    >
      {header}
      {week.focus && <Muted className="mb-3 px-1">{week.focus}</Muted>}
      <ErrorText>{summary.error}</ErrorText>
      {summary.data ? (
        <ul>
          <WeekCard key={week.weekNo} week={summary.data} isCurrent plan={plan} readOnly />
        </ul>
      ) : (
        !summary.error && <Muted>Henter …</Muted>
      )}
    </Screen>
  );
}
