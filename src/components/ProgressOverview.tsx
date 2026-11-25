import { useId, useState } from 'react';
import type { ExerciseHistoryEntry } from '../../shared/history';
import type { Plan } from '../../shared/plan.schema';
import { getExercise } from '../../shared/resolve';
import { todayIso } from '../lib/dates';
import { illustrationFor } from '../logic/illustrations';
import { formatDecimal } from '../logic/numbers';
import { bestReps, MEASURE_UNIT, progression, repsAtTop, weeklyProgress, type Progression, type Trend } from '../logic/strength';
import { Figure } from '../ui/Figure';
import { Card, Group, InsetList, InsetRow } from '../ui/InsetList';
import { LineChart } from '../ui/LineChart';
import { Muted } from '../ui/Screen';
import { Segmented } from '../ui/Segmented';

type Period = '1' | '3' | 'alt';
const PERIOD_DAYS: Record<Period, number> = { '1': 31, '3': 92, alt: 0 };

const daysBack = (iso: string, days: number) => new Date(Date.parse(iso + 'T00:00:00Z') - days * 86_400_000).toISOString().slice(0, 10);
const signed = (n: number, digits = 1) => {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${formatDecimal(Math.abs(r))}`;
};
const pct = (p: number) => `${signed(p * 100, 0)} %`;

const GROUP_TITLE: Record<Trend, string> = { frem: 'Går frem', uændret: 'Står stille', tilbage: 'Går tilbage' };
const GROUP_HINT: Record<Trend, string> = {
  frem: 'Stærkere eller flere reps end første gang i perioden.',
  uændret: 'Under 1 % fra første gang.',
  tilbage: 'Lavere end første gang. Ofte en bevidst lettere uge eller ny øvelse.',
};

/** Fra første til seneste gang: "50 → 60 kg · 8 → 10 reps", "6 → 8 reps", "30 → 45 sek". */
export function progressDetail(p: Progression): string {
  const kg = (n: number | null) => (n == null ? '–' : formatDecimal(n));
  if (p.measure === 'styrke') return `${kg(p.first.topWeight)} → ${kg(p.last.topWeight)} kg · ${repsAtTop(p.first) ?? '–'} → ${repsAtTop(p.last) ?? '–'} reps`;
  if (p.measure === 'tid') return `${p.first.maxSeconds ?? '–'} → ${p.last.maxSeconds ?? '–'} sek`;
  return `${bestReps(p.first.sets) ?? '–'} → ${bestReps(p.last.sets) ?? '–'} reps i bedste sæt`;
}

/** Lille kurve uden akser (målet over tid). */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const W = 56;
  const H = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Uændret: en vandret streg midt i feltet.
  const xy = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * (W - 4) + 2, max === min ? H / 2 : H - 3 - ((v - min) / (max - min)) * (H - 6)] as const);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} className="shrink-0 overflow-visible">
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--brand-pink)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-red)' }} />
        </linearGradient>
      </defs>
      <polyline points={xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" stroke={`url(#${uid})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xy.at(-1)![0]} cy={xy.at(-1)![1]} r={2.5} fill="var(--brand-red)" />
    </svg>
  );
}

function ProgressRow({ p, plan, query }: { p: Progression; plan: Plan | undefined; query: string }) {
  const exercise = plan && getExercise(plan, p.exerciseId);
  const name = exercise?.name ?? p.exerciseId;
  const ill = illustrationFor(p.exerciseId, name);
  const abs = p.measure === 'styrke' ? `1RM ${signed(p.change)} kg` : `${signed(p.change, 0)} ${MEASURE_UNIT[p.measure]}`;
  return (
    <InsetRow href={`/historik/oevelse/${p.exerciseId}${query}`} className="gap-3">
      <span className="w-12 shrink-0 rounded-[9px] bg-bg p-0.5">{ill ? <Figure illustration={ill} label="" className="block h-auto w-full" /> : <span className="block aspect-[5/4]" />}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-row">
          {name}
          {p.variant && <span className="text-secondary text-ink-2"> · {p.variant}</span>}
        </span>
        <span className="num block text-footnote text-ink-2">
          {progressDetail(p)} · {p.points.length} gange
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <Sparkline values={p.points.map((x) => x.value)} label={`Kurve for ${name}`} />
        <span className={`num text-secondary font-semibold ${p.trend === 'frem' ? 'text-brand-red' : 'text-ink-2'}`} title={abs}>
          {pct(p.changePct)}
        </span>
      </span>
    </InsetRow>
  );
}

/**
 * Bliver jeg stærkere? Den typiske fremgang uge for uge og hver øvelse fra første til seneste gang i
 * perioden, delt i går frem, står stille og går tilbage. Tryk på en øvelse viser dens graf.
 */
export function ProgressOverview({ histories, plan, query = '' }: { histories: Map<string, ExerciseHistoryEntry[]>; plan: Plan | undefined; query?: string }) {
  const [period, setPeriod] = useState<Period>('alt');
  const from = PERIOD_DAYS[period] ? daysBack(todayIso(), PERIOD_DAYS[period]) : '';
  const list = [...histories]
    .map(([id, h]) => progression(id, (plan && getExercise(plan, id)?.kind) ?? 'weight_reps', h, from))
    .filter((p): p is Progression => p !== null)
    .sort((a, b) => b.changePct - a.changePct);
  const weekly = weeklyProgress(list);
  const latest = weekly.at(-1);
  const groups = (['frem', 'uændret', 'tilbage'] as const).map((t) => [t, list.filter((p) => p.trend === t)] as const);

  return (
    <>
      <Segmented
        className="mb-5"
        label="Periode"
        value={period}
        onChange={setPeriod}
        options={[
          { value: '1', label: '1 md' },
          { value: '3', label: '3 mdr' },
          { value: 'alt', label: 'Alt' },
        ]}
      />
      {list.length === 0 ? (
        <Muted>Fremgangen vises, når en øvelse er logget mindst to gange{period === 'alt' ? '' : ' i perioden'}.</Muted>
      ) : (
        <>
          <Card className="mb-3">
            <p className="text-secondary text-ink-2">Typisk fremgang siden første gang</p>
            <p className="num mb-3 flex items-baseline gap-1.5">
              <span className="text-gradient text-[44px] leading-none font-bold tracking-[-0.03em]">{latest ? signed(latest.value, 0) : '±0'}</span>
              <span className="text-unit text-brand-red">%</span>
            </p>
            {weekly.length > 1 && (
              <LineChart
                key={period}
                label="Typisk fremgang pr. uge"
                unit="%"
                points={weekly.map((w) => ({ key: w.date, date: w.date, value: w.value, detail: `${signed(w.value, 1)} % i ugen (${w.exercises} øvelser)` }))}
              />
            )}
            <p className="mt-2 text-footnote text-ink-2">
              Medianen af alle øvelsers fremgang. Vægtøvelser måles på beregnet 1RM, så både mere vægt og flere reps tæller; kropsvægt på reps i bedste sæt og tid på længste sæt.
            </p>
          </Card>
          <dl className="mb-10 grid grid-cols-3 gap-3 px-1">
            {groups.map(([t, items]) => (
              <div key={t}>
                <dt className="text-footnote text-ink-2">{GROUP_TITLE[t]}</dt>
                <dd className={`num text-title ${t === 'frem' && items.length ? 'text-brand-red' : ''}`}>{items.length}</dd>
              </div>
            ))}
          </dl>
          {groups.map(
            ([t, items]) =>
              items.length > 0 && (
                <Group key={t} title={GROUP_TITLE[t]} description={GROUP_HINT[t]}>
                  <InsetList inset={76}>
                    {items.map((p) => (
                      <ProgressRow key={p.exerciseId} p={p} plan={plan} query={query} />
                    ))}
                  </InsetList>
                </Group>
              ),
          )}
        </>
      )}
    </>
  );
}
