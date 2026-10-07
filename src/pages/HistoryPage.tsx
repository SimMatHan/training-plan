import { useState } from 'react';
import { Link } from 'wouter';
import { getExercise, getSession, weekForDate } from '../../shared/resolve';
import type { WeeklySummary } from '../../shared/history';
import { Screen } from '../components/Screen';
import { TrafficLight } from '../components/TrafficLight';
import { useExerciseOverview, useWeeklySummaries } from '../data/history';
import { usePlan } from '../data/plan';
import { formatShort, todayIso, WEEKDAYS_SHORT } from '../lib/dates';
import { sessionTitle } from '../lib/sessions';
import { formatDecimal } from '../logic/numbers';
import { PlanStatus } from './PlanStatus';

type Tab = 'oevelser' | 'uger';
const TAB_KEY = 'traeningsnav.historyTab';

function readTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'uger' ? 'uger' : 'oevelser';
  } catch {
    return 'oevelser';
  }
}

export function HistoryPage() {
  const { active } = usePlan();
  const [tab, setTab] = useState<Tab>(readTab);
  if (!active) return <PlanStatus title="Historik" />;

  const choose = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // Ikke kritisk.
    }
  };

  return (
    <Screen title="Historik">
      <div role="group" aria-label="Vis historik pr." className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-line p-1">
        {(['oevelser', 'uger'] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => choose(t)}
            className={`min-h-12 rounded-md font-semibold ${tab === t ? 'bg-fg text-bg' : 'text-muted'}`}
          >
            {t === 'oevelser' ? 'Øvelser' : 'Uger'}
          </button>
        ))}
      </div>
      {tab === 'oevelser' ? <ExerciseList /> : <WeekList />}
    </Screen>
  );
}

function ExerciseList() {
  const { active } = usePlan();
  const overview = useExerciseOverview();
  if (!overview || !active) return <p className="text-muted">Henter …</p>;
  if (overview.length === 0) return <p className="text-muted">Ingen øvelser logget endnu.</p>;

  return (
    <ul className="divide-y divide-line border-y border-line">
      {overview.map((o) => {
        const ex = getExercise(active.plan, o.exerciseId);
        const headline =
          ex?.kind === 'weight_reps' && o.last.topWeight != null
            ? `${formatDecimal(o.last.topWeight)} kg`
            : ex?.kind === 'time' && o.last.maxSeconds != null
              ? `${o.last.maxSeconds} sek`
              : `${o.last.totalReps} reps`;
        return (
          <li key={o.exerciseId}>
            <Link href={`/historik/oevelse/${o.exerciseId}`} className="flex min-h-16 items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{ex?.name ?? o.exerciseId}</span>
                <span className="num block text-sm text-muted">
                  {o.times} {o.times === 1 ? 'gang' : 'gange'} · sidst {formatShort(o.last.date)}
                </span>
              </span>
              <span className="num text-xl font-semibold">{headline}</span>
              <span aria-hidden="true" className="text-xl text-muted">
                ›
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function WeekList() {
  const { active } = usePlan();
  const plan = active?.plan;
  const today = todayIso();
  const current = plan ? (weekForDate(plan, today)?.weekNo ?? (today < plan.startDate ? 0 : plan.weeks.length)) : 0;
  const summaries = useWeeklySummaries(plan, current);
  if (!summaries) return <p className="text-muted">Henter …</p>;
  if (summaries.length === 0) return <p className="text-muted">Planen er ikke startet endnu.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {summaries.map((w) => (
        <WeekCard key={w.weekNo} week={w} isCurrent={w.weekNo === current} />
      ))}
    </ul>
  );
}

const LIGHT_DOT = { grøn: 'bg-mob', gul: 'bg-run', rød: 'bg-a', afventer: 'border-2 border-muted', ukendt: 'border-2 border-dashed border-muted' } as const;

function WeekCard({ week, isCurrent }: { week: WeeklySummary; isCurrent: boolean }) {
  const { active } = usePlan();
  const [open, setOpen] = useState(isCurrent);
  const title = (id: string, fallback: string) => {
    const s = active && getSession(active.plan, id);
    return s ? sessionTitle(s) : fallback;
  };
  return (
    <li className="rounded-lg bg-surface">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-16 w-full items-center gap-3 p-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">
            Uge {week.weekNo}
            <span className="font-normal text-muted">
              {' '}
              · {formatShort(week.startDate)}–{formatShort(week.endDate)} · {week.phase}
            </span>
          </span>
          <span className="num block text-sm">
            {week.done}/{week.planned} sessioner{week.runKm > 0 && ` · ${formatDecimal(week.runKm)} km løb`}
            {week.mobilityDays > 0 && ` · mobilitet ${week.mobilityDays} ${week.mobilityDays === 1 ? 'dag' : 'dage'}`}
          </span>
        </span>
        {week.lights.length > 0 && (
          <span className="flex gap-1" aria-label={`Trafiklys: ${week.lights.join(', ')}`}>
            {week.lights.map((l, i) => (
              <span key={i} aria-hidden="true" className={`size-3 rounded-full ${LIGHT_DOT[l]}`} />
            ))}
          </span>
        )}
        <span aria-hidden="true" className="text-muted">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-3 pt-2 pb-3">
          <ul className="divide-y divide-line">
            {week.sessions.map((s) => (
              <li key={s.sessionId} className="flex min-h-12 items-center gap-3 text-sm">
                <span className="w-9 text-muted">{WEEKDAYS_SHORT[s.day]}</span>
                <span className="min-w-0 flex-1">
                  {s.workoutUuid ? (
                    <Link href={`/session/${s.workoutUuid}`} className="underline decoration-line underline-offset-4">
                      {title(s.sessionId, s.name)}
                    </Link>
                  ) : (
                    title(s.sessionId, s.name)
                  )}
                  {s.optional && <span className="text-muted"> · valgfri</span>}
                </span>
                {s.light && <TrafficLight light={s.light} />}
                <span className={s.status === 'lavet' ? 'font-medium text-mob-ink' : 'text-muted'}>
                  {s.status === 'lavet' ? '✓ Lavet' : s.status === 'i-gang' ? 'I gang' : '–'}
                </span>
              </li>
            ))}
          </ul>
          {week.volume.length > 0 && (
            <>
              <h3 className="mt-3 mb-1 text-sm font-semibold">Volumen pr. øvelse</h3>
              <table className="num w-full text-sm">
                <tbody>
                  {week.volume.map((v) => (
                    <tr key={v.exerciseId}>
                      <td className="py-0.5 pr-2">{v.name}</td>
                      <td className="py-0.5 text-right text-muted">
                        {v.sets} sæt · {v.reps} reps
                      </td>
                      <td className="py-0.5 pl-2 text-right">{v.volumeKg > 0 ? `${formatDecimal(v.volumeKg)} kg` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </li>
  );
}
