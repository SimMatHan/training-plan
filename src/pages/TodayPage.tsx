import { getSession, weekForDate } from '../../shared/resolve';
import { effectiveSessions } from '../../shared/schedule';
import { GateBox } from '../components/GateBox';
import { AddActivityButton } from '../components/AddActivitySheet';
import { CoachNotes } from '../components/CoachNotes';
import { MobilityCards } from '../components/MobilityCards';
import { MorningPainCards } from '../components/MorningPainCard';
import { ProposalBanner } from '../components/ProposalBanner';
import { Screen, Section } from '../components/Screen';
import { SessionAction } from '../components/SessionAction';
import { SessionMark } from '../components/SessionMark';
import { WeekSessions } from '../components/WeekSessions';
import { usePlan } from '../data/plan';
import { useWorstLights } from '../data/health';
import { useCoachNotes } from '../data/notes';
import { useWeekOverrides } from '../data/schedule';
import { useWeekWorkouts } from '../data/workouts';
import { formatLong, todayIso, weekday } from '../lib/dates';
import { sessionDetail, sessionTitle } from '../lib/sessions';
import { PlanStatus } from './PlanStatus';

export function TodayPage() {
  const { active, none, loading } = usePlan();
  const today = todayIso();
  const week = active ? weekForDate(active.plan, today) : undefined;
  const workouts = useWeekWorkouts(week?.weekNo);
  const groin = useWorstLights();
  const overrides = useWeekOverrides(week?.weekNo);
  const notes = useCoachNotes(week?.weekNo, { general: true });
  if (!active && none && !loading) return <NoPlanYet />;
  if (!active) return <PlanStatus title="I dag" />;

  const { plan } = active;
  // Dagens sessioner efter evt. flytninger.
  const todays = week ? effectiveSessions(week, overrides ?? []).filter((s) => s.day === weekday(today)) : [];
  const mobility = getSession(plan, 'mobilitet');

  return (
    <Screen title={week ? `Uge ${week.weekNo}` : 'Uden for planen'} eyebrow={formatLong(today)}>
      <MorningPainCards />
      <ProposalBanner />
      <CoachNotes notes={notes} plan={plan} />
      {week ? (
        <>
          <Section title="I dag">
            {todays.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg bg-surface p-4">
                <div className="min-w-0 flex-1">
                  <div className="narrow text-2xl font-bold">Hviledag</div>
                  {mobility && plan.mobility && <div className="text-muted">Mobilitetsblokken kan tages alene.</div>}
                </div>
                {mobility && plan.mobility && <SessionAction session={mobility} week={week} workouts={workouts} prominent />}
              </div>
            ) : (
              todays.map((s) => {
                const session = getSession(plan, s.sessionId)!;
                return (
                  <div key={s.sessionId} className="flex items-center gap-3 rounded-lg bg-surface p-4">
                    <SessionMark colorKey={session.colorKey} className="self-stretch" />
                    <div className="min-w-0 flex-1">
                      <div className="narrow text-2xl font-bold">{sessionTitle(session)}</div>
                      <div className="text-muted">{sessionDetail(s, session)}</div>
                    </div>
                    <SessionAction session={session} week={week} workouts={workouts} groin={groin} prominent />
                  </div>
                );
              })
            )}
          </Section>
          <GateBox plan={plan} week={week} />
          <MobilityCards />
          <Section title={`Ugens sessioner · ${week.phase}`}>
            {week.focus && <p className="mb-3 text-sm text-muted">{week.focus}</p>}
            <WeekSessions plan={plan} week={week} today={today} />
            <AddActivityButton />
          </Section>
        </>
      ) : (
        <p className="text-muted">
          Planen løber fra {formatLong(plan.startDate)} til {formatLong(plan.raceDate)}.
        </p>
      )}
    </Screen>
  );
}

/** En ny atlet uden plan: appen venter på, at Claude foreslår den første, og at hun godkender den. */
function NoPlanYet() {
  const { slug } = usePlan();
  return (
    <Screen title="Velkommen" eyebrow={formatLong(todayIso())}>
      <MorningPainCards />
      <ProposalBanner />
      <section className="mb-7 rounded-lg bg-surface p-4">
        <h2 className="mb-2 text-xl">Din første plan</h2>
        <p className="mb-3 text-muted">
          Appen venter på din første træningsplan. Bed Claude om at lave den i dit claude.ai-projekt. Planen dukker op her som et forslag, som du godkender —
          derefter kan du logge din første session.
        </p>
        <p className="text-sm text-muted">
          Forbindelsen til Claude: <span className="num break-all text-fg">{`${location.origin}/mcp/${slug}`}</span> (se Indstillinger → Claude).
        </p>
      </section>
      <MobilityCards />
    </Screen>
  );
}
