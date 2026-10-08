import { useState } from 'react';
import { getSession } from '../../shared/resolve';
import { saveMorningScore, useDuringScores, usePendingMorningChecks } from '../data/health';
import { useMonitors, usePlan } from '../data/plan';
import { sessionTitle } from '../lib/sessions';
import type { Workout } from '../../shared/records.schema';
import { Card } from '../ui/InsetList';
import { ScoreScale } from './ScoreScale';

/** "Hvordan er venstre lyske i morges?" — én pr. monitor, dagen efter en træning, indtil det er besvaret. */
export function MorningPainCards() {
  const pending = usePendingMorningChecks();
  return (
    <>
      {pending.map((p) => (
        <MorningPainCard key={p.monitorId} monitorId={p.monitorId} workout={p.workout} />
      ))}
    </>
  );
}

function MorningPainCard({ monitorId, workout }: { monitorId: number; workout: Workout }) {
  const { active } = usePlan();
  const monitor = useMonitors().find((m) => m.id === monitorId);
  const during = useDuringScores(workout.uuid).find((s) => s.monitor_id === monitorId)?.score;
  const [saving, setSaving] = useState(false);
  if (!monitor) return null;

  const session = workout.planned_session_id && active ? getSession(active.plan, workout.planned_session_id) : undefined;
  const label = monitor.label.charAt(0).toLowerCase() + monitor.label.slice(1);

  return (
    <section aria-labelledby={`morning-${monitorId}`} className="mb-8">
      <Card>
        <h2 id={`morning-${monitorId}`} className="text-title">
          Hvordan er {label} i morges?
        </h2>
        <p className="mb-4 text-secondary text-ink-2">
          Dagen efter {session ? sessionTitle(session) : (workout.activity ?? 'træningen')}
          {during != null && (
            <>
              {' '}
              (under: <span className="num">{during}</span>/10)
            </>
          )}
          .
        </p>
        <ScoreScale
          label={`${monitor.label} nu`}
          value={null}
          onChange={async (v) => {
            if (saving) return;
            setSaving(true);
            await saveMorningScore(monitorId, workout.uuid, v);
          }}
        />
      </Card>
    </section>
  );
}
