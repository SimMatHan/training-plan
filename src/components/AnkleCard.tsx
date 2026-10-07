import { Link } from 'wouter';
import { measurementDue } from '../../shared/mobility';
import { useMobilityPoints } from '../data/health';
import { usePlan } from '../data/plan';
import { formatShort, todayIso } from '../lib/dates';
import { formatDecimal } from '../logic/numbers';

/** Ankel-status på I dag: seneste forskel og påmindelse når der skal måles. */
export function AnkleCard() {
  const points = useMobilityPoints();
  const { active } = usePlan();
  if (!points || !active) return null;
  const { due, days, last } = measurementDue(points, todayIso(), active.plan.mobility.measurement.reminderDays);

  return (
    <Link
      href="/ankel"
      className={`mb-7 flex min-h-14 items-center gap-3 rounded-lg p-4 ${due ? 'border-2 border-mob' : 'bg-surface'}`}
    >
      <span aria-hidden="true" className="inline-block h-10 w-1.5 shrink-0 rounded-full bg-mob" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{due ? 'Tid til knæ-til-væg-måling' : 'Ankel, knæ-til-væg'}</span>
        <span className="num block text-sm text-muted">
          {last
            ? `Forskel ${formatDecimal(last.diff)} cm · målt ${formatShort(last.date)}${days === 0 ? ' (i dag)' : days === 1 ? ' (i går)' : days != null ? ` (${days} dage siden)` : ''}`
            : 'Ingen målinger endnu'}
        </span>
      </span>
      <span aria-hidden="true" className="text-xl text-muted">
        ›
      </span>
    </Link>
  );
}
