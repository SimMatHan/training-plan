import { useEffect } from 'react';
import { useLocation, useRoute, useSearch } from 'wouter';
import { usePlan } from '../data/plan';
import { statusOf, useWeekWorkouts } from '../data/workouts';
import { SessionPage } from './SessionPage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /session/<træningens uuid> åbner logningen; /session/<sessionId>?uge=<n> er et link fra kalenderen
 * (med &dag=<planens dag>, når sessionen står flere gange i ugen).
 */
export function SessionRoute() {
  const [, params] = useRoute('/session/:id');
  return params && UUID.test(params.id) ? <SessionPage /> : <SessionLink sessionId={params?.id} />;
}

/**
 * Kalenderlink: åbner ugens træning for sessionen, hvis den er startet eller lavet,
 * ellers ugen i planen. Der oprettes ikke en træning bare ved at åbne linket.
 */
function SessionLink({ sessionId }: { sessionId: string | undefined }) {
  const search = new URLSearchParams(useSearch());
  const weekNo = Number(search.get('uge')) || undefined;
  const plannedDay = Number(search.get('dag')) || undefined;
  const [, navigate] = useLocation();
  const { active, loading } = usePlan();
  const workouts = useWeekWorkouts(weekNo);
  const week = active?.plan.weeks.find((w) => w.weekNo === weekNo);

  useEffect(() => {
    if (!workouts || (loading && !active)) return;
    const { workout } = sessionId && week ? statusOf(workouts, { week, sessionId, plannedDay }) : {};
    navigate(workout ? `/session/${workout.uuid}` : weekNo ? `/uge?uge=${weekNo}` : '/uge', { replace: true });
  }, [workouts, sessionId, week, weekNo, plannedDay, loading, active, navigate]);

  return null;
}
