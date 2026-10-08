import { Check } from '@phosphor-icons/react';
import { useState } from 'react';
import { useLocation } from 'wouter';
import type { PainAssessment } from '../../shared/pain';
import type { Session, Week } from '../../shared/plan.schema';
import type { Workout } from '../../shared/records.schema';
import { usePlan } from '../data/plan';
import { startSession, statusOf, type SessionStatus } from '../data/workouts';
import { SmallButton } from '../ui/Button';
import { StatusLight } from '../ui/StatusLight';

/** Status for en planlagt session og en funktion, der starter eller åbner ugens træning. */
export function useSessionOpener(session: Session, week: Week, workouts: Workout[] | undefined) {
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

  return { status, workout, open, busy };
}

export const actionLabel: Record<SessionStatus, string> = { 'ikke-lavet': 'Start', 'i-gang': 'Fortsæt', lavet: 'Vis', 'sprunget-over': 'Vis' };

/** Lille status + knap i en ugerække. */
export function SessionAction({
  session,
  week,
  workouts,
  groin,
}: {
  session: Session;
  week: Week;
  /** undefined mens ugens træninger indlæses — så vises ingen knap, så en lavet session ikke ligner "Start". */
  workouts: Workout[] | undefined;
  /** Det værste trafiklys pr. træning (alle monitors). */
  groin?: Map<string, PainAssessment>;
}) {
  const { status, workout, open, busy } = useSessionOpener(session, week, workouts);
  if (!workouts) return <div className="min-h-11 min-w-16" />;
  if (status === 'sprunget-over') return null;
  const light = workout && groin?.get(workout.uuid)?.light;

  return (
    <div className="flex shrink-0 items-center gap-2">
      {status === 'lavet' && (
        <span className="flex flex-col items-end gap-0.5">
          <span className="inline-flex items-center gap-1 text-secondary font-medium">
            <Check size={14} weight="bold" className="text-status-green" aria-hidden="true" /> Lavet
          </span>
          {light && <StatusLight light={light} />}
        </span>
      )}
      <SmallButton onClick={() => void open()} disabled={busy} aria-label={`${actionLabel[status]} ${session.name}`}>
        {actionLabel[status]}
      </SmallButton>
    </div>
  );
}
