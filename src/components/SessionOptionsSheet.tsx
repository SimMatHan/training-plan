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
import { PrimaryButton, SecondaryButton } from '../ui/Button';
import { ChoiceGrid, TextField } from '../ui/Field';
import { Sheet } from '../ui/Sheet';

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
        <p className="text-headline">Sprunget over</p>
        <p className="mb-5 text-secondary text-ink-2">{[skipped.skip_reason, skipped.note].filter(Boolean).join(' · ') || 'Ingen årsag angivet.'}</p>
        <SecondaryButton onClick={() => void undoSkip()}>Fortryd — sessionen er ikke sprunget over</SecondaryButton>
      </Sheet>
    );

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <h3 className="text-headline">Flyt til en anden dag</h3>
      <p className="mb-3 text-secondary text-ink-2">
        Planlagt {WEEKDAYS[scheduled.plannedDay]} {formatShort(dateOfDay(week, scheduled.plannedDay))}. Prikken markerer planens dag.
      </p>
      <div role="group" aria-label="Dag" className="grid grid-cols-7 gap-1">
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
              className={`flex min-h-16 flex-col items-center justify-center rounded-[10px] text-footnote ${selected ? 'bg-ink font-semibold text-surface' : 'bg-surface-2 text-ink'}`}
            >
              <span>{WEEKDAYS_SHORT[day]}</span>
              <span className="num text-headline">{Number(date.slice(8, 10))}</span>
              {day === scheduled.plannedDay && !selected && <span aria-hidden="true" className="mt-0.5 size-1.5 rounded-full bg-ink-2" />}
            </button>
          );
        })}
      </div>
      {scheduled.moved && (
        <SecondaryButton onClick={() => void move(scheduled.plannedDay)} className="mt-2">
          Tilbage til {WEEKDAYS[scheduled.plannedDay]}
        </SecondaryButton>
      )}

      <hr className="my-6 border-separator" />

      <h3 className="text-headline">Spring over</h3>
      <p className="mb-3 text-secondary text-ink-2">Logges, så det står i historikken og ikke bare som misset.</p>
      <ChoiceGrid label="Årsag" columns={3} options={REASONS} value={reason} onChange={(r) => setReason(reason === r ? null : r)} />
      <div className="mt-3">
        <TextField label="Note (valgfri)" type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <PrimaryButton onClick={() => void skip()} disabled={busy} className="mt-5">
        Markér som sprunget over
      </PrimaryButton>
    </Sheet>
  );
}
