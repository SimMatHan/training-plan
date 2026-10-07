import { useState } from 'react';
import { useLocation } from 'wouter';
import type { GroinAssessment } from '../../shared/groin';
import type { Session, Week } from '../../shared/plan.schema';
import type { Workout } from '../../shared/records.schema';
import { usePlan } from '../data/plan';
import { startSession, statusOf } from '../data/workouts';
import { TrafficLight } from './TrafficLight';

/** Status og ét-tryks start/fortsæt for en planlagt session. */
export function SessionAction({
  session,
  week,
  workouts,
  groin,
  prominent = false,
  primary = prominent,
}: {
  session: Session;
  week: Week;
  /** undefined mens ugens træninger indlæses — så vises ingen knap, så en lavet session ikke ligner "Start". */
  workouts: Workout[] | undefined;
  groin?: Map<string, GroinAssessment>;
  prominent?: boolean;
  /** Fyldt "Start"-knap (dagens session). Andre dage får en rolig kantknap. */
  primary?: boolean;
}) {
  const { active } = usePlan();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const { status, workout } = statusOf(workouts ?? [], session.id);

  async function open() {
    if (busy || !active) return;
    setBusy(true);
    try {
      const uuid = workout?.uuid ?? (await startSession({ session, weekNo: week.weekNo, planVersion: active.meta.version }));
      navigate(`/session/${uuid}`);
    } finally {
      setBusy(false);
    }
  }

  const statusText = status === 'lavet' ? 'Lavet' : status === 'i-gang' ? 'I gang' : null;
  const light = workout && groin?.get(workout.uuid)?.light;
  const label = status === 'ikke-lavet' ? 'Start' : status === 'i-gang' ? 'Fortsæt' : 'Vis';
  if (!workouts) return <div className={`shrink-0 ${prominent ? 'min-h-12 min-w-24' : 'min-h-12 min-w-12'}`} />;

  return (
    <div className="flex shrink-0 items-center gap-2">
      {statusText && (
        <span className="flex flex-col items-end gap-0.5">
          <span className={`text-sm font-medium ${status === 'lavet' ? 'text-mob-ink' : 'text-yellow-ink'}`}>
            {status === 'lavet' && <span aria-hidden="true">✓ </span>}
            {statusText}
          </span>
          {light && <TrafficLight light={light} />}
        </span>
      )}
      {(status !== 'lavet' || prominent) && (
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          className={`min-h-12 rounded-lg px-4 font-semibold ${status === 'ikke-lavet' && primary ? 'bg-fg text-bg' : 'border border-line'} ${prominent ? 'min-w-24 text-lg' : ''}`}
        >
          {label}
        </button>
      )}
      {status === 'lavet' && !prominent && (
        <button type="button" onClick={() => void open()} aria-label={`Vis ${session.name}`} className="min-h-12 min-w-12 rounded-lg text-muted">
          ›
        </button>
      )}
    </div>
  );
}
