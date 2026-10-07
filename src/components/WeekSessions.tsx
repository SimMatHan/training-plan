import type { Plan, Week } from '../../shared/plan.schema';
import { dateOfDay, getSession } from '../../shared/resolve';
import { formatShort, WEEKDAYS_SHORT } from '../lib/dates';
import { sessionDetail, sessionTitle } from '../lib/sessions';
import { SessionMark } from './SessionMark';

/** Ugens planlagte sessioner pr. dag. Status og "start" kommer i milepæl 3. */
export function WeekSessions({ plan, week, today }: { plan: Plan; week: Week; today?: string }) {
  const sessions = [...week.sessions].sort((a, b) => a.day - b.day);
  return (
    <ul className="divide-y divide-line border-y border-line">
      {sessions.map((s) => {
        const session = getSession(plan, s.sessionId)!;
        const date = dateOfDay(week, s.day);
        const isToday = date === today;
        return (
          <li key={s.sessionId} className="flex min-h-14 items-stretch gap-3 py-2.5">
            <SessionMark colorKey={session.colorKey} />
            <div className="w-12 shrink-0 pt-0.5">
              <div className={`text-sm ${isToday ? 'font-semibold' : 'text-muted'}`}>{WEEKDAYS_SHORT[s.day]}</div>
              <div className="num text-xs text-muted">{formatShort(date)}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{sessionTitle(session)}</div>
              <div className="text-sm text-muted">{sessionDetail(s, session)}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
