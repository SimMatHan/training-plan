// Ugens faktiske program: planens sessioner med eventuelle flytninger lagt ovenpå.
// Bruges af appen, services og (fase 2) kalenderfeedet.
import type { ScheduledSession, Week } from './plan.schema';
import type { ScheduleOverride } from './records.schema';

export interface EffectiveSession extends ScheduledSession {
  /** Dagen i planen. `day` er den faktiske dag efter en eventuel flytning. */
  plannedDay: number;
  moved: boolean;
}

/** Planens sessioner for ugen med flytninger anvendt, sorteret efter faktisk dag. */
export function effectiveSessions(week: Week, overrides: ScheduleOverride[]): EffectiveSession[] {
  const moves = new Map(
    overrides.filter((o) => !o.deleted_at && o.week_no === week.weekNo).map((o) => [o.session_id, o.day]),
  );
  return week.sessions
    .map((s, i) => {
      const day = moves.get(s.sessionId) ?? s.day;
      return { session: { ...s, day, plannedDay: s.day, moved: day !== s.day }, i };
    })
    .sort((a, b) => a.session.day - b.session.day || a.i - b.i)
    .map((x) => x.session);
}
