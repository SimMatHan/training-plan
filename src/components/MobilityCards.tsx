import { DEFAULT_REMINDER_DAYS, measurementDue, type MobilityPoint } from '../../shared/mobility';
import type { MobilityTest } from '../../shared/athletes';
import { useMobilityTrends } from '../data/health';
import { useMobilityTests, usePlan } from '../data/plan';
import { formatShort, todayIso } from '../lib/dates';
import { formatDecimal } from '../logic/numbers';
import { TILE_INSET } from '../ui/ExerciseRow';
import { IconTile } from '../ui/IconTile';
import { InsetList, InsetRow, RowText, RowValue } from '../ui/InsetList';
import { LineChart } from '../ui/LineChart';

/** Påmindelsen gælder pr. test: planens antal dage, ellers 14. */
export function useReminderDays(): number {
  return usePlan().active?.plan.mobility?.measurement?.reminderDays ?? DEFAULT_REMINDER_DAYS;
}

/** Seneste resultat som kort tekst: "Forskel 2 cm" (pr. side) eller "12,5 cm". */
export function latestText(test: MobilityTest, last: MobilityPoint) {
  return test.per_side ? `Forskel ${formatDecimal(last.diff)} ${test.unit}` : `${formatDecimal(last.value)} ${test.unit}`;
}

/** Mobilitetstests på I dag: seneste resultat og påmindelse, når der skal måles. */
export function MobilityCards() {
  const tests = useMobilityTests();
  const trends = useMobilityTrends(tests);
  const reminderDays = useReminderDays();
  if (!trends?.length) return null;
  return (
    <InsetList inset={TILE_INSET} className="mb-8">
      {trends.map(({ test, points }) => {
        const { due, days, last } = measurementDue(points, todayIso(), reminderDays);
        return (
          <InsetRow key={test.id} href={`/mobilitet#test-${test.id}`}>
            <IconTile category="mobility" />
            <RowText
              title={due ? `Tid til ${test.name.toLowerCase()}-måling` : test.name}
              detail={last ? `Målt ${formatShort(last.date)}${days === 0 ? ' (i dag)' : days === 1 ? ' (i går)' : days != null ? ` · ${days} dage siden` : ''}` : 'Ingen målinger endnu'}
            />
            {last && <RowValue primary={latestText(test, last)} />}
          </InsetRow>
        );
      })}
    </InsetList>
  );
}

/** Udviklingen i én test: forskellen mellem siderne (mål 0) eller værdien. */
export function MobilityChart({ test, points }: { test: MobilityTest; points: MobilityPoint[] }) {
  return test.per_side ? (
    <LineChart
      label={`${test.name}: forskel mellem siderne`}
      unit={test.unit}
      goal={0}
      points={points.map((p) => ({
        key: p.uuid,
        date: p.date,
        value: p.diff!,
        detail: `højre ${formatDecimal(p.right)} ${test.unit} · venstre ${formatDecimal(p.left)} ${test.unit} · forskel ${formatDecimal(p.diff)} ${test.unit}`,
      }))}
    />
  ) : (
    <LineChart label={test.name} unit={test.unit} points={points.map((p) => ({ key: p.uuid, date: p.date, value: p.value! }))} />
  );
}
