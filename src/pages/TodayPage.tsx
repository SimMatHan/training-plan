import { getSession, weekForDate } from '../../shared/resolve';
import { effectiveSessions } from '../../shared/schedule';
import { AnkleCard } from '../components/AnkleCard';
import { GateBox } from '../components/GateBox';
import { AddActivityButton } from '../components/AddActivitySheet';
import { MorningGroinCard } from '../components/MorningGroinCard';
import { Screen, Section } from '../components/Screen';
import { SessionAction } from '../components/SessionAction';
import { SessionMark } from '../components/SessionMark';
import { WeekSessions } from '../components/WeekSessions';
import { usePlan } from '../data/plan';
import { useGroinAssessments } from '../data/health';
import { useWeekOverrides } from '../data/schedule';
import { useWeekWorkouts } from '../data/workouts';
import { formatLong, todayIso, weekday } from '../lib/dates';
import { sessionDetail, sessionTitle } from '../lib/sessions';
import { PlanStatus } from './PlanStatus';

export function TodayPage() {
  const { active } = usePlan();
  const today = todayIso();
  const week = active ? weekForDate(active.plan, today) : undefined;
  const workouts = useWeekWorkouts(week?.weekNo);
  const groin = useGroinAssessments();
  const overrides = useWeekOverrides(week?.weekNo);
  if (!active) return <PlanStatus title="I dag" />;

  const { plan } = active;
  // Dagens sessioner efter evt. flytninger.
  const todays = week ? effectiveSessions(week, overrides ?? []).filter((s) => s.day === weekday(today)) : [];
  const mobility = getSession(plan, 'mobilitet');

  return (
    <Screen title={week ? `Uge ${week.weekNo}` : 'Uden for planen'} eyebrow={formatLong(today)}>
      <MorningGroinCard />
      {week ? (
        <>
          <Section title="I dag">
            {todays.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg bg-surface p-4">
                <div className="min-w-0 flex-1">
                  <div className="narrow text-2xl font-bold">Hviledag</div>
                  <div className="text-muted">Mobilitetsblokken kan tages alene.</div>
                </div>
                {mobility && <SessionAction session={mobility} week={week} workouts={workouts} prominent />}
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
          <AnkleCard />
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
