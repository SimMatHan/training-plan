import type { Plan, Week } from '../../shared/plan.schema';
import { dateOfDay, getSession } from '../../shared/resolve';
import { useGroinAssessments } from '../data/health';
import { statusOf, useWeekWorkouts } from '../data/workouts';
import { formatShort, todayIso, WEEKDAYS_SHORT } from '../lib/dates';
import { sessionDetail, sessionTitle } from '../lib/sessions';
import { dayState } from '../logic/progress';
import { SessionAction } from './SessionAction';
import { SessionMark } from './SessionMark';

/**
 * Ugens sessioner med status. Ugen er fleksibel: alle kan startes alle dage.
 * I dag markeres; en planlagt dag der er passeret uden træning vises dæmpet som "misset".
 */
export function WeekSessions({ plan, week, today = todayIso() }: { plan: Plan; week: Week; today?: string }) {
  const workouts = useWeekWorkouts(week.weekNo);
  const groin = useGroinAssessments();
  const sessions = [...week.sessions].sort((a, b) => a.day - b.day);
  return (
    <ul className="divide-y divide-line border-y border-line">
      {sessions.map((s) => {
        const session = getSession(plan, s.sessionId)!;
        const date = dateOfDay(week, s.day);
        const state = dayState(date, today);
        const missed = !!workouts && state === 'past' && !s.optional && statusOf(workouts, s.sessionId, today).status === 'ikke-lavet';
        return (
          <li
            key={s.sessionId}
            aria-current={state === 'today' ? 'date' : undefined}
            className={`flex min-h-16 items-center gap-3 py-2.5 ${state === 'today' ? '-mx-3 rounded-lg bg-surface px-3' : ''}`}
          >
            <SessionMark colorKey={session.colorKey} muted={missed} className="self-stretch" />
            <div className="w-11 shrink-0">
              <div className={`text-sm ${state === 'today' ? 'font-semibold' : 'text-muted'}`}>{state === 'today' ? 'I dag' : WEEKDAYS_SHORT[s.day]}</div>
              <div className="num text-xs text-muted">{formatShort(date)}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className={`font-medium ${missed ? 'text-muted' : ''}`}>{sessionTitle(session)}</div>
              <div className="text-sm text-muted">
                {missed && (
                  <span className="mr-1.5 inline-flex items-center gap-1">
                    <span aria-hidden="true" className="inline-block size-2 rounded-full border border-dashed border-muted" />
                    Misset
                    {sessionDetail(s, session) && <span aria-hidden="true"> ·</span>}
                  </span>
                )}
                {sessionDetail(s, session)}
              </div>
            </div>
            <SessionAction session={session} week={week} workouts={workouts} groin={groin} primary={state === 'today'} />
          </li>
        );
      })}
    </ul>
  );
}
