import type { ScheduledSession, Session } from '../../shared/plan.schema';
import { formatRange } from '../../shared/resolve';

/** Titel på et sessionskort: løb vises ved type ("Tærskel"), styrke ved navn. */
export function sessionTitle(session: Session): string {
  if ((session.kind === 'løb' || session.kind === 'cardio') && session.code && session.code !== 'LØB')
    return session.workoutType.replace(/\s*\(.*\)$/, '');
  return session.name;
}

/** Detaljelinje: kode og mål for løb ("T2 · 3 × 10 min"), "let" for lette styrkeuger. */
export function sessionDetail(scheduled: ScheduledSession, session: Session): string {
  const parts: string[] = [];
  if (session.kind === 'løb' || session.kind === 'cardio') {
    if (session.code && session.code !== 'LØB') parts.push(session.code);
    if (scheduled.targetKm) parts.push(formatRange(scheduled.targetKm, ' km'));
    else if (scheduled.targetMin) parts.push(formatRange(scheduled.targetMin, ' min'));
    else if (session.code) parts.push(session.mainSet);
    if (/strides/.test(scheduled.label) && !/strides/.test(parts.join(' '))) parts.push('strides');
  } else if (/\(let\)/.test(scheduled.label)) {
    parts.push('let uge');
  }
  if (scheduled.optional) parts.push('valgfri');
  if (scheduled.condition) parts.push(scheduled.condition.toLowerCase());
  return parts.join(' · ');
}
