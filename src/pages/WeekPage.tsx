import { useState } from 'react';
import { useSearch } from 'wouter';
import { dateOfDay, weekForDate } from '../../shared/resolve';
import { AddActivityButton } from '../components/AddActivitySheet';
import { GateBox } from '../components/GateBox';
import { Screen } from '../components/Screen';
import { WeekSessions } from '../components/WeekSessions';
import { usePlan } from '../data/plan';
import { formatShort, todayIso } from '../lib/dates';
import { PlanStatus } from './PlanStatus';

export function WeekPage() {
  const { active } = usePlan();
  const today = todayIso();
  const plan = active?.plan;
  const current = plan ? (weekForDate(plan, today)?.weekNo ?? (today < plan.startDate ? 1 : plan.weeks.length)) : 1;
  // ?uge=<n> fra et kalenderlink åbner den uge.
  const linked = Number(new URLSearchParams(useSearch()).get('uge')) || undefined;
  const [weekNo, setWeekNo] = useState<number | undefined>(linked);
  if (!plan) return <PlanStatus title="Uge" />;

  const shown = weekNo && plan.weeks.some((w) => w.weekNo === weekNo) ? weekNo : current;
  const index = plan.weeks.findIndex((w) => w.weekNo === shown);
  const week = plan.weeks[index];
  const step = (d: number) => setWeekNo(plan.weeks[index + d]?.weekNo ?? shown);

  return (
    <Screen title={`Uge ${week.weekNo}`} eyebrow={`${formatShort(week.startDate)}–${formatShort(dateOfDay(week, 7))} · ${week.phase}`}>
      <div className="mb-4 flex gap-2">
        <button type="button" onClick={() => step(-1)} disabled={index === 0} className="min-h-12 flex-1 rounded-lg border border-line font-medium disabled:opacity-30">
          Forrige uge
        </button>
        <button type="button" onClick={() => step(1)} disabled={index === plan.weeks.length - 1} className="min-h-12 flex-1 rounded-lg border border-line font-medium disabled:opacity-30">
          Næste uge
        </button>
      </div>
      {week.focus && <p className="mb-3 text-sm text-muted">{week.focus}</p>}
      {week.kmLabel && <p className="mb-3 text-sm text-muted">Km i ugen: <span className="num">{week.kmLabel}</span></p>}
      <WeekSessions plan={plan} week={week} today={today} />
      <AddActivityButton />
      <div className="mt-6">
        <GateBox plan={plan} week={week} />
      </div>
    </Screen>
  );
}
