// Ugens faktiske program: planens sessioner med eventuelle flytninger lagt ovenpå.
// Bruges af appen, services og (fase 2) kalenderfeedet.
//
// En planlagt session identificeres af (uge, sessionId, planens dag). Planens dag ændrer sig ikke, når
// sessionen flyttes. Står en session kun én gang i ugen, er dagen ligegyldig: træninger og flytninger uden
// dag (alt fra før gentagne sessioner) hører til den, præcis som før.
import type { ScheduledSession, Week } from './plan.schema';
import type { ScheduleOverride } from './records.schema';

export interface EffectiveSession extends ScheduledSession {
  /** Dagen i planen. `day` er den faktiske dag efter en eventuel flytning. */
  plannedDay: number;
  moved: boolean;
  /** Sessionen står flere gange i ugen; forekomsterne skelnes på `plannedDay`. */
  repeated: boolean;
}

/** Nøgle for én forekomst af en session i en uge. */
export const occurrenceKey = (sessionId: string, plannedDay: number) => `${sessionId}|${plannedDay}`;

/** Om sessionen står mere end én gang i ugen. */
export const isRepeated = (week: Week, sessionId: string) => week.sessions.filter((s) => s.sessionId === sessionId).length > 1;

/** Planens linje i ugen for en træning: forekomsten på planens dag, ellers sessionens første i ugen. */
export const scheduledOf = (week: Week | undefined, sessionId: string, plannedDay: number | null | undefined): ScheduledSession | undefined =>
  week?.sessions.find((s) => s.sessionId === sessionId && s.day === plannedDay) ?? week?.sessions.find((s) => s.sessionId === sessionId);

/**
 * Fordeler poster (træninger eller flytninger) på ugens forekomster af deres session, nøgle `occurrenceKey`.
 * Står sessionen én gang, får den alle sessionens poster, uanset planned_day. Står den flere gange, går en post
 * til forekomsten med samme planned_day; en post uden (eller med en dag, planen ikke har længere) går til den
 * første forekomst, der endnu ingen post har, ellers til den første. Rækkefølgen inden for en forekomst bevares.
 */
export function assignToOccurrences<T>(
  week: Week,
  records: T[],
  sessionIdOf: (r: T) => string | null,
  plannedDayOf: (r: T) => number | null,
): Map<string, T[]> {
  const days = new Map<string, number[]>();
  for (const s of [...week.sessions].sort((a, b) => a.day - b.day)) days.set(s.sessionId, [...(days.get(s.sessionId) ?? []), s.day]);
  const out = new Map<string, T[]>();
  const add = (key: string, r: T) => out.set(key, [...(out.get(key) ?? []), r]);
  const loose: [string, T][] = [];
  for (const r of records) {
    const id = sessionIdOf(r);
    const occurrences = id ? days.get(id) : undefined;
    if (!id || !occurrences) continue;
    const day = plannedDayOf(r);
    if (occurrences.length === 1) add(occurrenceKey(id, occurrences[0]), r);
    else if (day !== null && occurrences.includes(day)) add(occurrenceKey(id, day), r);
    else loose.push([id, r]);
  }
  for (const [id, r] of loose) {
    const occurrences = days.get(id)!;
    const free = occurrences.find((d) => !out.has(occurrenceKey(id, d))) ?? occurrences[0];
    add(occurrenceKey(id, free), r);
  }
  return out;
}

/** Planens sessioner for ugen med flytninger anvendt, sorteret efter faktisk dag. */
export function effectiveSessions(week: Week, overrides: ScheduleOverride[]): EffectiveSession[] {
  const live = overrides.filter((o) => !o.deleted_at && o.week_no === week.weekNo);
  const moves = assignToOccurrences(
    week,
    live,
    (o) => o.session_id,
    (o) => o.planned_day ?? null,
  );
  return week.sessions
    .map((s, i) => {
      // Flere flytninger for samme forekomst (fx en gammel uden dag og en ny): den nyeste gælder.
      const move = (moves.get(occurrenceKey(s.sessionId, s.day)) ?? []).reduce<ScheduleOverride | undefined>(
        (a, b) => (!a || b.updated_at >= a.updated_at ? b : a),
        undefined,
      );
      const day = move?.day ?? s.day;
      return { session: { ...s, day, plannedDay: s.day, moved: day !== s.day, repeated: isRepeated(week, s.sessionId) }, i };
    })
    .sort((a, b) => a.session.day - b.session.day || a.i - b.i)
    .map((x) => x.session);
}
