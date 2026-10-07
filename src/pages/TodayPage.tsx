import { getSession, weekForDate } from '../../shared/resolve';
import { Screen, Section } from '../components/Screen';
import { SessionMark } from '../components/SessionMark';
import { WeekSessions } from '../components/WeekSessions';
import { usePlan } from '../data/plan';
import { formatLong, todayIso, weekday } from '../lib/dates';
import { sessionDetail, sessionTitle } from '../lib/sessions';
import { PlanStatus } from './PlanStatus';

export function TodayPage() {
  const { active } = usePlan();
  const today = todayIso();
  if (!active) return <PlanStatus title="I dag" />;

  const { plan } = active;
  const week = weekForDate(plan, today);
  const todays = week?.sessions.filter((s) => s.day === weekday(today)) ?? [];

  return (
    <Screen title={week ? `Uge ${week.weekNo}` : 'Uden for planen'} eyebrow={formatLong(today)}>
      {week ? (
        <>
          <Section title="I dag">
            {todays.length === 0 ? (
              <p className="text-muted">Ingen planlagt session. Mobilitetsblokken kan tages alene.</p>
            ) : (
              todays.map((s) => {
                const session = getSession(plan, s.sessionId)!;
                return (
                  <div key={s.sessionId} className="flex gap-3 rounded-lg bg-surface p-4">
                    <SessionMark colorKey={session.colorKey} />
                    <div>
                      <div className="narrow text-2xl font-bold">{sessionTitle(session)}</div>
                      <div className="text-muted">{sessionDetail(s, session)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </Section>
          <Section title={`Ugens sessioner · ${week.phase}`}>
            {week.focus && <p className="mb-3 text-sm text-muted">{week.focus}</p>}
            <WeekSessions plan={plan} week={week} today={today} />
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
