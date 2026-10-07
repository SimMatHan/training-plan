import type { Session, Week } from '../../shared/plan.schema';
import { dateOfDay } from '../../shared/resolve';
import type { EffectiveSession } from '../../shared/schedule';
import { moveSession } from '../data/schedule';
import { formatShort, WEEKDAYS, WEEKDAYS_SHORT } from '../lib/dates';
import { sessionTitle } from '../lib/sessions';
import { Sheet } from './Sheet';

/** Flyt en planlagt session til en anden dag i samme uge. */
export function MoveSheet({
  open,
  onClose,
  week,
  scheduled,
  session,
}: {
  open: boolean;
  onClose: () => void;
  week: Week;
  scheduled: EffectiveSession;
  session: Session;
}) {
  async function choose(day: number) {
    if (day !== scheduled.day) await moveSession(week.weekNo, scheduled.sessionId, day, scheduled.plannedDay);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Flyt ${sessionTitle(session)}`}>
      <p className="mb-3 text-sm text-muted">
        Planlagt {WEEKDAYS[scheduled.plannedDay]} {formatShort(dateOfDay(week, scheduled.plannedDay))} Vælg en anden dag i uge {week.weekNo}.
      </p>
      <div role="group" aria-label="Dag" className="grid grid-cols-7 gap-0.5">
        {[1, 2, 3, 4, 5, 6, 7].map((day) => {
          const selected = day === scheduled.day;
          const date = dateOfDay(week, day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={selected}
              aria-label={`${WEEKDAYS[day]} ${formatShort(date)}${day === scheduled.plannedDay ? ', planens dag' : ''}`}
              onClick={() => void choose(day)}
              className={`flex min-h-16 flex-col items-center justify-center rounded-lg text-sm ${
                selected ? 'bg-fg font-semibold text-bg' : 'border border-line'
              }`}
            >
              <span>{WEEKDAYS_SHORT[day]}</span>
              <span className="num text-base">{Number(date.slice(8, 10))}</span>
              {day === scheduled.plannedDay && !selected && <span aria-hidden="true" className="mt-0.5 size-1.5 rounded-full bg-muted" />}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">Prikken markerer planens dag.</p>
      {scheduled.moved && (
        <button type="button" onClick={() => void choose(scheduled.plannedDay)} className="mt-4 min-h-12 w-full rounded-lg border border-line font-medium">
          Tilbage til {WEEKDAYS[scheduled.plannedDay]}
        </button>
      )}
    </Sheet>
  );
}
