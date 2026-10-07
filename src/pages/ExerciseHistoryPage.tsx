import { useState } from 'react';
import { Link, useRoute } from 'wouter';
import { getExercise, getSession } from '../../shared/resolve';
import { Screen } from '../components/Screen';
import { TrendChart } from '../components/TrendChart';
import { useExerciseHistory } from '../data/history';
import { usePlan } from '../data/plan';
import { formatShort } from '../lib/dates';
import { summarizeSets } from '../logic/lastTime';
import { formatDecimal } from '../logic/numbers';
import { PlanStatus } from './PlanStatus';

type Metric = 'top' | 'volumen';

export function ExerciseHistoryPage() {
  const [, params] = useRoute('/historik/oevelse/:id');
  const exerciseId = params?.id ?? '';
  const { active } = usePlan();
  const history = useExerciseHistory(exerciseId);
  const [metric, setMetric] = useState<Metric>('top');
  if (!active) return <PlanStatus title="Historik" />;

  const exercise = getExercise(active.plan, exerciseId);
  const name = exercise?.name ?? exerciseId;
  const kind = exercise?.kind ?? 'weight_reps';
  const chronological = [...(history ?? [])].reverse();

  // Vægtøvelser: topvægt eller volumen. Kropsvægt: reps i alt. Tid: længste sæt.
  const series =
    kind === 'weight_reps'
      ? metric === 'top'
        ? { unit: 'kg', label: 'Topvægt', value: (e: (typeof chronological)[number]) => e.topWeight }
        : { unit: 'kg', label: 'Volumen (vægt × reps)', value: (e: (typeof chronological)[number]) => e.volumeKg }
      : kind === 'time'
        ? { unit: 'sek', label: 'Længste sæt', value: (e: (typeof chronological)[number]) => e.maxSeconds }
        : { unit: 'reps', label: 'Reps i alt', value: (e: (typeof chronological)[number]) => e.totalReps };
  const points = chronological
    .map((e) => ({ key: e.workoutUuid, date: e.date, value: series.value(e) }))
    .filter((p): p is { key: string; date: string; value: number } => p.value != null);

  return (
    <Screen title={name} eyebrow={<Link href="/historik">← Historik</Link>}>
      {history === undefined ? (
        <p className="text-muted">Henter …</p>
      ) : history.length === 0 ? (
        <p className="text-muted">Ingen logninger endnu.</p>
      ) : (
        <>
          {kind === 'weight_reps' && (
            <div role="group" aria-label="Vis" className="mb-3 grid grid-cols-2 gap-1 rounded-lg border border-line p-1">
              {(['top', 'volumen'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={metric === m}
                  onClick={() => setMetric(m)}
                  className={`min-h-12 rounded-md font-semibold ${metric === m ? 'bg-fg text-bg' : 'text-muted'}`}
                >
                  {m === 'top' ? 'Topvægt' : 'Volumen'}
                </button>
              ))}
            </div>
          )}
          <h2 className="mb-1 text-lg">{series.label}</h2>
          {points.length > 0 ? (
            <TrendChart key={metric} label={series.label} unit={series.unit} points={points} />
          ) : (
            <p className="mb-4 text-sm text-muted">Ingen vægt logget endnu.</p>
          )}

          <h2 className="mt-6 mb-2 text-lg">Alle gange</h2>
          <ul className="divide-y divide-line border-y border-line">
            {history.map((e) => {
              const session = e.sessionId ? getSession(active.plan, e.sessionId) : undefined;
              return (
                <li key={e.workoutUuid} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/session/${e.workoutUuid}`} className="font-semibold underline decoration-line underline-offset-4">
                      {formatShort(e.date)}
                    </Link>
                    <span className="text-sm text-muted">
                      {e.weekNo && `Uge ${e.weekNo} · `}
                      {session?.name}
                    </span>
                  </div>
                  <p className="num mt-0.5">
                    {summarizeSets(e.sets, kind)}
                    {e.rpe != null && <span className="text-muted">, RPE {formatDecimal(e.rpe)}</span>}
                  </p>
                  {e.note && <p className="mt-0.5 text-sm text-muted">“{e.note}”</p>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Screen>
  );
}
