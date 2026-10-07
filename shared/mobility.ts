// Ankelmobilitet (knæ-til-væg). Højre achilles er den stramme side; målet er
// at højre når venstre, dvs. forskellen (venstre − højre) bliver 0.
import type { MobilityMeasurement } from './records.schema';

export interface MobilityPoint {
  uuid: string;
  date: string;
  right: number;
  left: number;
  /** venstre − højre i cm. Positiv = højre er strammest. */
  diff: number;
  note: string | null;
}

export function mobilityTrend(measurements: MobilityMeasurement[]): MobilityPoint[] {
  return measurements
    .filter((m) => !m.deleted_at && m.knee_to_wall_right_cm != null && m.knee_to_wall_left_cm != null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.updated_at.localeCompare(b.updated_at))
    .map((m) => ({
      uuid: m.uuid,
      date: m.date,
      right: m.knee_to_wall_right_cm!,
      left: m.knee_to_wall_left_cm!,
      diff: Math.round((m.knee_to_wall_left_cm! - m.knee_to_wall_right_cm!) * 10) / 10,
      note: m.note,
    }));
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000);

/** Påmindelse når der er gået `reminderDays` dage siden sidste måling. */
export function measurementDue(points: MobilityPoint[], today: string, reminderDays: number) {
  const last = points.at(-1);
  const days = last ? daysBetween(last.date, today) : null;
  return { due: days === null || days >= reminderDays, days, last };
}
