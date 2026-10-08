import { parseGate, worstByWorkout } from '../../shared/pain';
import type { Plan, Week } from '../../shared/plan.schema';
import { getSession } from '../../shared/resolve';
import { usePainAssessments } from '../data/health';
import { sessionTitle } from '../lib/sessions';
import { Card } from '../ui/InsetList';
import { StatusLight } from '../ui/StatusLight';

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
    <section aria-labelledby="gate" className="mb-8">
      <Card>
        <h2 id="gate" className="text-title">
          Port til uge {gate.toWeek}
        </h2>
        <p className="mb-3 text-secondary text-ink-2">{plan.groin?.gate}</p>
        {relevant.length === 0 ? (
          <p className="text-secondary">Ingen trafiklys i uge {gate.weeks.join(' og ')} endnu.</p>
        ) : (
          <>
            <p className="num mb-2 text-headline">
              {green} af {relevant.length} grønne i uge {gate.weeks.join(' og ')}
            </p>
            <ul className="inset-list">
              {relevant.map((a) => {
                const s = a.plannedSessionId ? getSession(plan, a.plannedSessionId) : undefined;
                return (
                  <li key={a.workoutUuid} className="flex min-h-11 items-center justify-between gap-3 text-secondary" style={{ ['--sep-inset' as string]: '0px' }}>
                    <span>
                      Uge {a.weekNo} · {s ? sessionTitle(s) : 'Træning'}
                    </span>
                    <StatusLight light={a.light} />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </section>
  );
}
