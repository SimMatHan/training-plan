import { Check, Circle, CircleHalf, MinusCircle } from '@phosphor-icons/react';
import type { ExerciseHistoryEntry } from '../../shared/history';
import type { Plan, Week } from '../../shared/plan.schema';
import { getSession, weekForDate } from '../../shared/resolve';
import { effectiveSessions } from '../../shared/schedule';
import { AddActivityButton } from '../components/AddActivitySheet';
import { CoachNotes } from '../components/CoachNotes';
import { GateBox } from '../components/GateBox';
import { MobilityCards } from '../components/MobilityCards';
import { MorningPainCards } from '../components/MorningPainCard';
import { ProposalBanner } from '../components/ProposalBanner';
import { useSessionOpener } from '../components/SessionAction';
import { SyncBadge } from '../components/SyncBadge';
import { TodayCard } from '../components/TodayCard';
import { useWorstLights } from '../data/health';
import { useExerciseOverview } from '../data/history';
import { useCoachNotes } from '../data/notes';
import { usePlan } from '../data/plan';
import { useWeekOverrides } from '../data/schedule';
import { statusOf, useWeekWorkouts, type SessionStatus } from '../data/workouts';
import { useMe } from '../lib/auth';
import { formatLong, todayIso, weekday, WEEKDAYS_SHORT } from '../lib/dates';
import { sessionDetail, sessionTitle } from '../lib/sessions';
import { Avatar } from '../ui/Avatar';
import { SecondaryButton } from '../ui/Button';
import { Card, Group, InsetList, InsetRow, RowText } from '../ui/InsetList';
import { Muted, Screen } from '../ui/Screen';
import { PlanStatus } from './PlanStatus';

/** "Uge 6 af 14, tærskelfase". */
const weekLine = (plan: Plan, week: Week) => `Uge ${week.weekNo} af ${plan.weeks.length}, ${week.phase.toLowerCase().replace(/(fase)?$/, 'fase')}`;

export function TodayPage() {
  const { active, none, loading } = usePlan();
  const me = useMe();
  const today = todayIso();
  const week = active ? weekForDate(active.plan, today) : undefined;
  const workouts = useWeekWorkouts(week?.weekNo);
  const groin = useWorstLights();
  const overrides = useWeekOverrides(week?.weekNo);
  const notes = useCoachNotes(week?.weekNo, { general: true });
  const overview = useExerciseOverview();
  if (!active && none && !loading) return <NoPlanYet />;
  if (!active) return <PlanStatus title="I dag" />;

  const { plan } = active;
  const sessions = week ? effectiveSessions(week, overrides ?? []) : [];
  // Dagens sessioner efter evt. flytninger, og resten af ugen.
  const todays = sessions.filter((s) => s.day === weekday(today));
  const rest = sessions.filter((s) => s.day > weekday(today));
  const mobility = getSession(plan, 'mobilitet');
  const last = new Map<string, ExerciseHistoryEntry>((overview ?? []).map((o) => [o.exerciseId, o.last]));
  const accessory = (
    <>
      <SyncBadge quiet />
      <Avatar name={me.user.name} />
    </>
  );

  return (
    <Screen title="I dag" subtitle={week ? weekLine(plan, week) : formatLong(today)} accessory={accessory}>
      {week ? (
        <>
          {todays.length === 0 ? (
            <Card className="mb-8">
              <h2 className="text-title">Hviledag</h2>
              {mobility && plan.mobility && (
                <>
                  <Muted className="mt-0.5">Mobilitetsblokken kan tages alene.</Muted>
                  <RestDayMobility session={mobility} week={week} workouts={workouts} />
                </>
              )}
            </Card>
          ) : (
            todays.map((s) => (
              <TodayCard key={s.sessionId} plan={plan} week={week} scheduled={s} session={getSession(plan, s.sessionId)!} workouts={workouts} groin={groin} last={last} />
            ))
          )}
          <MorningPainCards />
          <ProposalBanner />
          <CoachNotes notes={notes} plan={plan} />
          <GateBox plan={plan} week={week} />
          <MobilityCards />
          <Group title="Resten af ugen" footer={week.focus}>
            {rest.length > 0 ? (
              <InsetList>
                {rest.map((s) => {
                  const session = getSession(plan, s.sessionId)!;
                  const { status } = workouts ? statusOf(workouts, s.sessionId, today) : { status: undefined };
                  return (
                    <InsetRow key={s.sessionId} href="/uge" chevron={false}>
                      <span className="w-10 shrink-0 text-secondary text-ink-2">{WEEKDAYS_SHORT[s.day].replace(/^./, (c) => c.toUpperCase())}</span>
                      <RowText title={sessionTitle(session)} detail={sessionDetail(s, session) || undefined} />
                      <StatusIcon status={status} />
                    </InsetRow>
                  );
                })}
              </InsetList>
            ) : (
<Muted className="px-1">Ikke flere sessioner i denne uge.</Muted>
            )}
            <AddActivityButton />
          </Group>
        </>
      ) : (
        <Muted>
          Planen løber fra {formatLong(plan.startDate)} til {formatLong(plan.raceDate)}.
        </Muted>
      )}
    </Screen>
  );
}

const STATUS_TEXT: Record<SessionStatus, string> = { 'ikke-lavet': 'Ikke lavet', 'i-gang': 'I gang', lavet: 'Lavet', 'sprunget-over': 'Sprunget over' };

/** Status som ikon med skjult tekst: ○ ikke lavet, ◐ i gang, ✓ lavet, ⊖ sprunget over. */
export function StatusIcon({ status }: { status: SessionStatus | undefined }) {
  if (!status) return null;
  const Glyph = status === 'lavet' ? Check : status === 'i-gang' ? CircleHalf : status === 'sprunget-over' ? MinusCircle : Circle;
  return (
    <span className="grid size-6 shrink-0 place-items-center" title={STATUS_TEXT[status]}>
      <Glyph size={22} weight={status === 'lavet' ? 'bold' : 'regular'} className={status === 'lavet' ? 'text-status-green' : 'text-ink-3'} aria-hidden="true" />
      <span className="sr-only">{STATUS_TEXT[status]}</span>
    </span>
  );
}

function RestDayMobility({ session, week, workouts }: { session: NonNullable<ReturnType<typeof getSession>>; week: Week; workouts: ReturnType<typeof useWeekWorkouts> }) {
  const { status, open, busy } = useSessionOpener(session, week, workouts);
  return (
    <SecondaryButton onClick={() => void open()} disabled={busy || !workouts} className="mt-4">
      {status === 'lavet' ? 'Mobilitet lavet · vis' : status === 'i-gang' ? 'Fortsæt mobilitet' : 'Start mobilitet'}
    </SecondaryButton>
  );
}

/** En ny atlet uden plan: appen venter på, at Claude foreslår den første, og at hun godkender den. */
function NoPlanYet() {
  const { slug } = usePlan();
  const me = useMe();
  return (
    <Screen title="Velkommen" subtitle={formatLong(todayIso())} accessory={<Avatar name={me.user.name} />}>
      <MorningPainCards />
      <ProposalBanner />
      <Card className="mb-8">
        <h2 className="mb-2 text-title">Din første plan</h2>
        <p className="mb-3 text-body text-ink-2">
          Appen venter på din første træningsplan. Bed Claude om at lave den i dit claude.ai-projekt. Planen dukker op her som et forslag, som du godkender —
          derefter kan du logge din første session.
        </p>
        <p className="text-footnote text-ink-2">
          Forbindelsen til Claude: <span className="num break-all text-ink">{`${location.origin}/mcp/${slug}`}</span> (se Indstillinger → Claude).
        </p>
      </Card>
      <MobilityCards />
    </Screen>
  );
}
