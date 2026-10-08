// Mobilitetstests (fx knee-to-wall). For tests pr. side er forskellen venstre − højre; for
// knee-to-wall er højre achilles den stramme side, og målet er forskel 0.
import type { MobilityMeasurement } from './records.schema';

export interface MobilityPoint {
  uuid: string;
  date: string;
  right: number | null;
  left: number | null;
  /** Værdien for tests uden sider. */
  value: number | null;
  /** venstre − højre for tests pr. side, ellers null. */
  diff: number | null;
  note: string | null;
}

/** Påmindelse om en ny måling efter så mange dage, hvis planen ikke siger andet. */
export const DEFAULT_REMINDER_DAYS = 14;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Målingerne i én test, ældste først. Tests pr. side kræver begge sider. */
export function mobilityTrend(measurements: MobilityMeasurement[], test: { id: number; per_side: boolean }): MobilityPoint[] {
  return measurements
    .filter((m) => !m.deleted_at && m.test_id === test.id && (test.per_side ? m.value_right != null && m.value_left != null : m.value != null))
    .sort((a, b) => a.date.localeCompare(b.date) || a.updated_at.localeCompare(b.updated_at))
    .map((m) => ({
      uuid: m.uuid,
      date: m.date,
      right: test.per_side ? m.value_right : null,
      left: test.per_side ? m.value_left : null,
      value: test.per_side ? null : m.value,
      diff: test.per_side ? round1(m.value_left! - m.value_right!) : null,
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
