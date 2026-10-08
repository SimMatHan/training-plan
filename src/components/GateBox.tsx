import { parseGate, worstByWorkout } from '../../shared/pain';
import type { Plan, Week } from '../../shared/plan.schema';
import { getSession } from '../../shared/resolve';
import { usePainAssessments } from '../data/health';
import { sessionTitle } from '../lib/sessions';
import { TrafficLight } from './TrafficLight';

/**
 * Porten efter rehab-blokken: vises i ugen før porten med trafiklysene for de afgørende uger
 * (det værste lys pr. træning på tværs af monitors).
 */
export function GateBox({ plan, week }: { plan: Plan; week: Week }) {
  const gate = parseGate(plan.groin?.gate);
  const show = !!gate && week.weekNo === gate.toWeek - 1;
  const assessments = [...worstByWorkout(usePainAssessments()).values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!show || !gate) return null;

  const relevant = assessments.filter((a) => a.weekNo != null && gate.weeks.includes(a.weekNo));
  const green = relevant.filter((a) => a.light === 'grøn').length;

  return (
    <section aria-labelledby="gate" className="mb-7 rounded-lg bg-surface p-4">
      <h2 id="gate" className="mb-1 text-xl">
        Port til uge {gate.toWeek}
      </h2>
      <p className="mb-3 text-sm text-muted">{plan.groin?.gate}</p>
      {relevant.length === 0 ? (
        <p className="text-sm">Ingen trafiklys i uge {gate.weeks.join(' og ')} endnu.</p>
      ) : (
        <>
          <p className="num mb-2 font-medium">
            {green} af {relevant.length} grønne i uge {gate.weeks.join(' og ')}
          </p>
          <ul className="divide-y divide-line text-sm">
            {relevant.map((a) => {
              const s = a.plannedSessionId ? getSession(plan, a.plannedSessionId) : undefined;
              return (
                <li key={a.workoutUuid} className="flex min-h-10 items-center justify-between gap-3">
                  <span>
                    Uge {a.weekNo} · {s ? sessionTitle(s) : 'Træning'}
                  </span>
                  <TrafficLight light={a.light} />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
