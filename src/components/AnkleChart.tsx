import type { MobilityPoint } from '../../shared/mobility';
import { formatDecimal } from '../logic/numbers';
import { TrendChart } from './TrendChart';

/** Forskel mellem siderne over tid (venstre − højre, cm). Målet er 0. */
export function AnkleChart({ points }: { points: MobilityPoint[] }) {
  return (
    <TrendChart
      label="Forskel mellem siderne"
      unit="cm"
      goal={0}
      points={points.map((p) => ({
        key: p.uuid,
        date: p.date,
        value: p.diff,
        detail: `højre ${formatDecimal(p.right)} cm · venstre ${formatDecimal(p.left)} cm · forskel ${formatDecimal(p.diff)} cm`,
      }))}
    />
  );
}
