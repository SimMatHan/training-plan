import { useState } from 'react';
import { getSession } from '../../shared/resolve';
import { saveMorningCheck, usePendingMorningCheck } from '../data/health';
import { usePlan } from '../data/plan';
import { sessionTitle } from '../lib/sessions';
import { ScoreScale } from './ScoreScale';

/** "Hvordan er lysken i morges?" — vises dagen efter en træning, indtil det er besvaret. */
export function MorningGroinCard() {
  const workout = usePendingMorningCheck();
  const { active } = usePlan();
  const [saving, setSaving] = useState(false);
  if (!workout) return null;

  const session = workout.planned_session_id && active ? getSession(active.plan, workout.planned_session_id) : undefined;

  return (
    <section aria-labelledby="morning-groin" className="mb-7 rounded-lg border-2 border-fg p-4">
      <h2 id="morning-groin" className="mb-1 text-2xl">
        Hvordan er lysken i morges?
      </h2>
      <p className="mb-3 text-sm text-muted">
        Venstre lyske, dagen efter {session ? sessionTitle(session) : 'træningen'} (under: <span className="num">{workout.groin_during}</span>/10).
      </p>
      <ScoreScale
        label="Lysken nu"
        value={null}
        onChange={async (v) => {
          if (saving) return;
          setSaving(true);
          await saveMorningCheck(workout.uuid, v);
        }}
      />
    </section>
  );
}
