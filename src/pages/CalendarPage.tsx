import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { CSSProperties } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { weekForDate } from '../../shared/resolve';
import { useCalendar } from '../data/calendar';
import { usePlan } from '../data/plan';
import { formatLong, fromIsoDate, todayIso } from '../lib/dates';
import { monthGrid, shiftMonth, type DayEntry, type DayState } from '../logic/calendar';
import { formatDecimal } from '../logic/numbers';
import { Card } from '../ui/InsetList';
import { Muted, Screen } from '../ui/Screen';
import { PlanStatus } from './PlanStatus';

const monthName = new Intl.DateTimeFormat('da-DK', { month: 'long' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const HEAD = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];

const STATE_TEXT: Record<DayState, string> = { lavet: 'lavet', 'i-gang': 'i gang', planlagt: 'planlagt', misset: 'misset', 'sprunget-over': 'sprunget over' };

/** En prik pr. session: fyldt = lavet, ring i kategoriens farve = planlagt, grå ring = misset eller sprunget over. */
function Dot({ entry }: { entry: Pick<DayEntry, 'category' | 'state'> }) {
  const color = `var(--cat-${entry.category})`;
  const style: CSSProperties =
    entry.state === 'lavet' || entry.state === 'i-gang'
      ? { background: color, opacity: entry.state === 'i-gang' ? 0.55 : 1 }
      : entry.state === 'planlagt'
        ? { boxShadow: `inset 0 0 0 1.5px ${color}` }
        : { boxShadow: 'inset 0 0 0 1.5px var(--ink-3)' };
  return <span aria-hidden="true" className="inline-block size-[7px] shrink-0 rounded-full" style={style} />;
}

function MonthNav({ month, onStep, showToday }: { month: string; onStep: (n: number) => void; showToday: boolean }) {
  const btn = 'grid size-11 place-items-center rounded-full bg-fill text-ink';
  return (
    <div className="flex items-center gap-2">
      {showToday && (
        <button type="button" onClick={() => onStep(0)} className="min-h-11 rounded-full bg-fill px-3.5 text-secondary font-semibold text-ink">
          I dag
        </button>
      )}
      <button type="button" onClick={() => onStep(-1)} aria-label={`Forrige måned (${cap(monthName.format(fromIsoDate(`${shiftMonth(month, -1)}-01`)))})`} className={btn}>
        <CaretLeft size={18} weight="bold" aria-hidden="true" />
      </button>
      <button type="button" onClick={() => onStep(1)} aria-label={`Næste måned (${cap(monthName.format(fromIsoDate(`${shiftMonth(month, 1)}-01`)))})`} className={btn}>
        <CaretRight size={18} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Hvad skete der, og hvad kommer? Måneden som kalender med en prik pr. session (farve efter kategori,
 * fyldt når den er lavet). Tryk på en dag åbner dagens overblik.
 */
export function CalendarPage() {
  const { active } = usePlan();
  const [, navigate] = useLocation();
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const linked = new URLSearchParams(useSearch()).get('m');
  const month = linked && /^\d{4}-\d{2}$/.test(linked) ? linked : thisMonth;
  const grid = monthGrid(month);
  const data = useCalendar(grid[0][0], grid.at(-1)![6]);
  if (!active) return <PlanStatus title="Kalender" picker />;
  const plan = active.plan;

  const step = (n: number) => navigate(n === 0 ? '/kalender' : `/kalender?m=${shiftMonth(month, n)}`, { replace: true });

  // Måneden i tal: lavede træninger (uden mobilitet), løbe-km og dage med mobilitet.
  const inMonth = [...(data?.entries ?? [])].filter(([d]) => d.startsWith(month));
  const done = inMonth.flatMap(([, list]) => list.filter((e) => e.state === 'lavet'));
  const trainings = done.filter((e) => e.workout?.type !== 'mobilitet').length;
  const km = done.reduce((sum, e) => sum + (e.workout?.type === 'løb' ? (e.workout.distance_km ?? 0) : 0), 0);
  const mobilityDays = new Set([
    ...done.filter((e) => e.workout?.type === 'mobilitet').map((e) => e.date),
    ...[...(data?.rounds ?? [])].filter(([d, r]) => d.startsWith(month) && r.some((x) => x.done > 0)).map(([d]) => d),
  ]).size;
  const planned = inMonth.flatMap(([, list]) => list.filter((e) => e.state === 'planlagt')).length;

  return (
    <Screen
      title={cap(monthName.format(fromIsoDate(`${month}-01`)))}
      subtitle={month.slice(0, 4)}
      accessory={<MonthNav month={month} onStep={step} showToday={month !== thisMonth} />}
    >
      <Card className="mb-3 px-2 pt-3 pb-2">
        <div className="grid grid-cols-[22px_repeat(7,minmax(0,1fr))] items-center">
          <span className="text-center text-caption text-ink-3" title="Uge i planen">
            Uge
          </span>
          {HEAD.map((d, i) => (
            <span key={i} className="pb-1 text-center text-caption font-semibold text-ink-2">
              {d}
            </span>
          ))}
          {grid.map((week) => {
            const planWeek = weekForDate(plan, week[0]) ?? weekForDate(plan, week[6]);
            return [
              <span key={`u${week[0]}`} className="num text-center text-caption text-ink-3" aria-hidden="true">
                {planWeek?.weekNo ?? ''}
              </span>,
              ...week.map((date) => {
                const entries = data?.entries.get(date) ?? [];
                const rounds = data?.rounds.get(date) ?? [];
                const mobility = rounds.some((r) => r.done > 0);
                const outside = !date.startsWith(month);
                const isToday = date === today;
                const label = [
                  formatLong(date) + (isToday ? ', i dag' : ''),
                  ...entries.map((e) => `${e.title} ${STATE_TEXT[e.state]}`),
                  ...rounds.filter((r) => r.done > 0).map((r) => `mobilitet ${r.round} ${r.done} af ${r.total}`),
                ].join(', ');
                return (
                  <Link
                    key={date}
                    href={`/dag/${date}`}
                    aria-label={label}
                    aria-current={isToday ? 'date' : undefined}
                    className={`flex min-h-[54px] flex-col items-center gap-1 rounded-[10px] pt-1 pb-1.5 transition-colors duration-150 active:bg-surface-2 ${outside ? 'opacity-35' : ''}`}
                  >
                    <span
                      className={`num grid size-8 place-items-center rounded-full text-body ${isToday ? 'bg-brand font-semibold text-on-brand' : 'text-ink'}`}
                    >
                      {Number(date.slice(8))}
                    </span>
                    <span className="flex h-[7px] items-center gap-[3px]">
                      {entries.slice(0, 3).map((e) => (
                        <Dot key={e.key} entry={e} />
                      ))}
                      {mobility && entries.length < 3 && <Dot entry={{ category: 'mobility', state: 'lavet' }} />}
                    </span>
                  </Link>
                );
              }),
            ];
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t-[0.5px] border-separator px-2 pt-2.5 text-footnote text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <Dot entry={{ category: 'legs', state: 'lavet' }} /> Lavet
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Dot entry={{ category: 'legs', state: 'planlagt' }} /> Planlagt
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Dot entry={{ category: 'legs', state: 'misset' }} /> Misset eller sprunget over
          </span>
        </div>
      </Card>
      <Muted className="mb-8 px-1">Tryk på en dag for at se hele dagens træning.</Muted>

      {data && (
        <section aria-label={`${cap(monthName.format(fromIsoDate(`${month}-01`)))} i tal`} className="mb-10">
          <h2 className="mb-3 px-1 text-title">{cap(monthName.format(fromIsoDate(`${month}-01`)))} i tal</h2>
          <Card>
            <dl className="grid grid-cols-3 gap-3">
              <Stat label="Træninger" value={String(trainings)} detail={planned ? `${planned} planlagt` : undefined} />
              <Stat label="Løb" value={formatDecimal(Math.round(km * 10) / 10) || '0'} unit="km" />
              <Stat label="Mobilitet" value={String(mobilityDays)} unit={mobilityDays === 1 ? 'dag' : 'dage'} />
            </dl>
          </Card>
        </section>
      )}
    </Screen>
  );
}

function Stat({ label, value, unit, detail }: { label: string; value: string; unit?: string; detail?: string }) {
  return (
    <div>
      <dt className="text-footnote text-ink-2">{label}</dt>
      <dd className="num text-title">
        {value}
        {unit && <span className="ml-1 text-secondary font-semibold">{unit}</span>}
      </dd>
      {detail && <dd className="num text-footnote text-ink-2">{detail}</dd>}
    </div>
  );
}
