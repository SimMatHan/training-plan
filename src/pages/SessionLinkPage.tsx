import { useEffect } from 'react';
import { useLocation, useRoute, useSearch } from 'wouter';
import { statusOf, useWeekWorkouts } from '../data/workouts';
import { SessionPage } from './SessionPage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /session/<træningens uuid> åbner logningen; /session/<sessionId>?uge=<n> er et link fra kalenderen. */
export function SessionRoute() {
  const [, params] = useRoute('/session/:id');
  return params && UUID.test(params.id) ? <SessionPage /> : <SessionLink sessionId={params?.id} />;
}

/**
 * Kalenderlink: åbner ugens træning for sessionen, hvis den er startet eller lavet,
 * ellers ugen i planen. Der oprettes ikke en træning bare ved at åbne linket.
 */
function SessionLink({ sessionId }: { sessionId: string | undefined }) {
  const weekNo = Number(new URLSearchParams(useSearch()).get('uge')) || undefined;
  const [, navigate] = useLocation();
  const workouts = useWeekWorkouts(weekNo);

  useEffect(() => {
    if (!workouts) return;
    const { workout } = sessionId ? statusOf(workouts, sessionId) : {};
    navigate(workout ? `/session/${workout.uuid}` : weekNo ? `/uge?uge=${weekNo}` : '/uge', { replace: true });
  }, [workouts, sessionId, weekNo, navigate]);

  return null;
}
