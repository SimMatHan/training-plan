import { useState } from 'react';
import type { Session, Week } from '../../shared/plan.schema';
import type { Workout } from '../../shared/records.schema';
import { dateOfDay } from '../../shared/resolve';
import type { EffectiveSession } from '../../shared/schedule';
import { usePlan } from '../data/plan';
import { deleteRecord } from '../data/records';
import { moveSession } from '../data/schedule';
import { skipSession } from '../data/workouts';
import { formatShort, WEEKDAYS, WEEKDAYS_SHORT } from '../lib/dates';
import { sessionTitle } from '../lib/sessions';
import { Sheet } from './Sheet';

const REASONS = ['Lyske/smerte', 'Achilles', 'Syg', 'Kalender/tid', 'Træt', 'Andet'];

/**
 * Muligheder for en planlagt session, der ikke er lavet: flyt til en anden dag
 * i ugen, eller markér den som sprunget over (logges med årsag).
 */
export function SessionOptionsSheet({
  open,
  onClose,
  week,
  scheduled,
  session,
  skipped,
}: {
  open: boolean;
  onClose: () => void;
  week: Week;
  scheduled: EffectiveSession;
  session: Session;
  /** Træningen hvis sessionen allerede er markeret som sprunget over. */
  skipped?: Workout;
}) {
  const { active } = usePlan();
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const title = sessionTitle(session);

  async function move(day: number) {
    if (day !== scheduled.day) await moveSession(week.weekNo, scheduled.sessionId, day, scheduled.plannedDay);
    onClose();
  }

  async function skip() {
    if (!active || busy) return;
    setBusy(true);
    try {
      await skipSession({
        session,
        weekNo: week.weekNo,
        planVersion: active.meta.version,
        date: dateOfDay(week, scheduled.day),
        reason,
        note: note.trim() || null,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function undoSkip() {
    if (!skipped) return;
    await deleteRecord('workouts', skipped.uuid);
    onClose();
  }

  if (skipped)
    return (
      <Sheet open={open} onClose={onClose} title={title}>
        <p className="mb-1 font-medium">Sprunget over</p>
        <p className="mb-4 text-sm text-muted">
          {[skipped.skip_reason, skipped.note].filter(Boolean).join(' · ') || 'Ingen årsag angivet.'}
        </p>
        <button type="button" onClick={() => void undoSkip()} className="min-h-12 w-full rounded-lg border border-line font-medium">
          Fortryd — sessionen er ikke sprunget over
        </button>
      </Sheet>
    );

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <h3 className="mb-1 text-lg">Flyt til en anden dag</h3>
      <p className="mb-2 text-sm text-muted">
        Planlagt {WEEKDAYS[scheduled.plannedDay]} {formatShort(dateOfDay(week, scheduled.plannedDay))} Prikken markerer planens dag.
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
              onClick={() => void move(day)}
              className={`flex min-h-16 flex-col items-center justify-center rounded-lg text-sm ${selected ? 'bg-fg font-semibold text-bg' : 'border border-line'}`}
            >
              <span>{WEEKDAYS_SHORT[day]}</span>
              <span className="num text-base">{Number(date.slice(8, 10))}</span>
              {day === scheduled.plannedDay && !selected && <span aria-hidden="true" className="mt-0.5 size-1.5 rounded-full bg-muted" />}
            </button>
          );
        })}
      </div>
      {scheduled.moved && (
        <button type="button" onClick={() => void move(scheduled.plannedDay)} className="mt-2 min-h-12 w-full rounded-lg border border-line font-medium">
          Tilbage til {WEEKDAYS[scheduled.plannedDay]}
        </button>
      )}

      <hr className="my-5 border-line" />

      <h3 className="mb-1 text-lg">Spring over</h3>
      <p className="mb-2 text-sm text-muted">Logges, så det står i historikken og ikke bare som misset.</p>
      <div role="group" aria-label="Årsag" className="grid grid-cols-3 gap-1.5">
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={reason === r}
            onClick={() => setReason(reason === r ? null : r)}
            className={`min-h-12 rounded-lg px-1 text-sm font-medium ${reason === r ? 'bg-fg text-bg' : 'border border-line'}`}
          >
            {r}
          </button>
        ))}
      </div>
      <label className="mt-3 flex flex-col gap-1 text-sm text-muted">
        Note (valgfri)
        <input
          type="text"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-12 rounded-lg border border-line bg-raised px-3 text-base text-fg"
        />
      </label>
      <button type="button" onClick={() => void skip()} disabled={busy} className="mt-4 min-h-14 w-full rounded-lg bg-fg text-lg font-semibold text-bg disabled:opacity-40">
        Markér som sprunget over
      </button>
    </Sheet>
  );
}
