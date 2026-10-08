import { CaretDown } from '@phosphor-icons/react';
import { useState } from 'react';
import { useRoute, useSearch } from 'wouter';
import type { ExerciseHistoryEntry } from '../../shared/history';
import { getExercise, getSession } from '../../shared/resolve';
import { useViewedAthlete } from '../components/AthletePicker';
import { useExerciseHistory } from '../data/history';
import { usePlan, type ActivePlan } from '../data/plan';
import { useRemote } from '../data/remote';
import { formatShort, todayIso } from '../lib/dates';
import { summarizeSets } from '../logic/lastTime';
import { formatDecimal } from '../logic/numbers';
import { HeroNumber } from '../ui/HeroNumber';
import { Card, Group, InsetList, InsetRow, RowText, RowValue } from '../ui/InsetList';
import { LineChart } from '../ui/LineChart';
import { Muted, Screen } from '../ui/Screen';
import { Segmented } from '../ui/Segmented';
import { PlanStatus } from './PlanStatus';
import { ReadOnlyNote } from './ProposalPage';

type Metric = 'top' | 'volumen';
const PERIODS = [
  { months: 1, label: '1 md' },
  { months: 3, label: '3 mdr' },
  { months: 6, label: '6 mdr' },
  { months: 0, label: 'Alt' },
] as const;

const monthsBack = (iso: string, months: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};

/** Bliver jeg stærkere? Bedste resultat som heltetal, grafen og alle gange. */
export function ExerciseHistoryPage() {
  const [, params] = useRoute('/historik/oevelse/:id');
  const exerciseId = params?.id ?? '';
  const { active: ownPlan } = usePlan();
  // ?atlet=<slug>: trænervisning, hentet fra serveren.
  const viewed = useViewedAthlete(new URLSearchParams(useSearch()).get('atlet'));
  const local = useExerciseHistory(exerciseId);
  const remote = useRemote<ExerciseHistoryEntry[]>(viewed.slug, viewed.own ? null : `/history/exercises/${encodeURIComponent(exerciseId)}`);
  const remotePlan = useRemote<ActivePlan | null>(viewed.slug, viewed.own ? null : '/plan/active');
  const [metric, setMetric] = useState<Metric>('top');
  const [months, setMonths] = useState<number>(3);
  const history = viewed.own ? local : remote.data;
  const active = viewed.own ? ownPlan : (remotePlan.data ?? undefined);
  if (!active && viewed.own) return <PlanStatus title="Historik" />;
  if (!viewed.own && (remote.error || remotePlan.error)) return <PlanStatus title="Historik" />;

  const exercise = active && getExercise(active.plan, exerciseId);
  const name = exercise?.name ?? exerciseId;
  const kind = exercise?.kind ?? 'weight_reps';
  const from = months ? monthsBack(todayIso(), months) : '';
  const chronological = [...(history ?? [])].reverse();
  const inPeriod = chronological.filter((e) => e.date >= from);

  // Vægtøvelser: topvægt eller volumen. Kropsvægt: reps i alt. Tid: længste sæt.
  type E = ExerciseHistoryEntry;
  const series =
    kind === 'weight_reps'
      ? metric === 'top'
        ? { unit: 'kg', label: 'Topvægt', value: (e: E) => e.topWeight }
        : { unit: 'kg', label: 'Volumen (vægt × reps)', value: (e: E) => e.volumeKg }
      : kind === 'time'
        ? { unit: 'sek', label: 'Længste sæt', value: (e: E) => e.maxSeconds }
        : { unit: 'reps', label: 'Reps i alt', value: (e: E) => e.totalReps };
  const toPoints = (list: E[]) =>
    list.map((e) => ({ key: e.workoutUuid, date: e.date, value: series.value(e) })).filter((p): p is { key: string; date: string; value: number } => p.value != null);
  const points = toPoints(inPeriod);
  const all = toPoints(chronological);
  const best = all.length ? Math.max(...all.map((p) => p.value)) : undefined;
  const change = points.length ? points.at(-1)!.value - points[0].value : undefined;
  const back = { href: viewed.own ? '/historik' : `/historik?atlet=${viewed.slug}`, label: 'Historik' };

  const period = (
    <label className="relative inline-flex min-h-11 items-center">
      <span className="sr-only">Periode</span>
      <select
        value={months}
        onChange={(e) => setMonths(Number(e.target.value))}
        className="min-h-9 appearance-none rounded-full bg-surface-2 pr-8 pl-3.5 text-secondary font-semibold text-ink"
      >
        {PERIODS.map((p) => (
          <option key={p.months} value={p.months}>
            {p.label}
          </option>
        ))}
      </select>
      <CaretDown size={14} weight="bold" className="pointer-events-none absolute right-3 text-ink-2" aria-hidden="true" />
    </label>
  );

  return (
    <Screen title={name} back={back} accessory={history?.length ? period : undefined}>
      {!viewed.own && <ReadOnlyNote name={viewed.name} />}
      {history === undefined ? (
        <Muted>Henter …</Muted>
      ) : history.length === 0 ? (
        <Muted>Ingen logninger endnu.</Muted>
      ) : (
        <>
          {kind === 'weight_reps' && (
            <Segmented
              className="mb-5"
              label="Vis"
              value={metric}
              onChange={setMetric}
              options={[
                { value: 'top', label: 'Vægt' },
                { value: 'volumen', label: 'Volumen' },
              ]}
            />
          )}
          {best != null && <HeroNumber className="mb-4 px-1" label="Bedste resultat" value={formatDecimal(best)} unit={series.unit} />}

          <Card className="mb-3">
            {points.length > 0 ? (
              <LineChart key={`${metric}-${months}`} label={series.label} unit={series.unit} points={points} />
            ) : (
              <Muted>{all.length ? 'Ingen logninger i perioden.' : 'Ingen vægt logget endnu.'}</Muted>
            )}
          </Card>

          {points.length > 0 && (
            <dl className="mb-8 grid grid-cols-3 gap-3 px-1">
              <Stat label="Start" value={formatDecimal(points[0].value)} unit={series.unit} />
              <Stat
                label="Stigning"
                value={`${change! > 0 ? '+' : change! < 0 ? '−' : ''}${formatDecimal(Math.abs(change!))}`}
                unit={series.unit}
                accent={change! > 0}
              />
              <Stat label="Pas" value={String(inPeriod.length)} />
            </dl>
          )}

          <Group title="Alle gange">
            <InsetList>
              {history.map((e) => {
                const session = e.sessionId && active ? getSession(active.plan, e.sessionId) : undefined;
                const v = series.value(e);
                return (
                  <InsetRow key={e.workoutUuid} href={viewed.own ? `/session/${e.workoutUuid}` : undefined}>
                    <RowText
                      title={formatShort(e.date)}
                      detail={
                        <>
                          {summarizeSets(e.sets, kind)}
                          {e.rpe != null && `, RPE ${formatDecimal(e.rpe)}`}
                          {e.note && <span className="block">“{e.note}”</span>}
                        </>
                      }
                    />
                    <RowValue primary={v != null ? `${formatDecimal(v)} ${series.unit}` : '–'} secondary={[e.weekNo && `Uge ${e.weekNo}`, session?.name].filter(Boolean).join(' · ')} />
                  </InsetRow>
                );
              })}
            </InsetList>
          </Group>
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value, unit, accent = false }: { label: string; value: string; unit?: string; accent?: boolean }) {
  return (
    <div>
      <dt className="text-footnote text-ink-2">{label}</dt>
      <dd className={`num text-title ${accent ? 'text-brand-red' : ''}`}>
        {value}
        {unit && <span className="ml-1 text-secondary font-semibold">{unit}</span>}
      </dd>
    </div>
  );
}
