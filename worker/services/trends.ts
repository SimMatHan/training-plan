// Trends for lyske og ankel. Kaldes af API'et og af MCP i fase 3.
import { assessGroin, type GroinAssessment } from '../../shared/groin';
import { mobilityTrend, type MobilityPoint } from '../../shared/mobility';
import { GroinCheck, MobilityMeasurement, Workout } from '../../shared/records.schema';

const parseRows = <T>(schema: { parse: (v: unknown) => T }, rows: Record<string, unknown>[]) => rows.map((r) => schema.parse(r));

/** Trafiklys pr. træning fra og med `fromDate` (YYYY-MM-DD). */
export async function getGroinTrend(db: D1Database, fromDate: string, today = new Date().toISOString().slice(0, 10)): Promise<GroinAssessment[]> {
  // Én dag før med, så "rød" (to i træk) kan vurderes for første træning i perioden.
  const [workouts, checks] = await Promise.all([
    db
      .prepare(`SELECT * FROM workouts WHERE deleted_at IS NULL AND groin_during IS NOT NULL AND type <> 'mobilitet' ORDER BY date`)
      .all<Record<string, unknown>>(),
    db.prepare('SELECT * FROM groin_checks WHERE deleted_at IS NULL').all<Record<string, unknown>>(),
  ]);
  const all = assessGroin(parseRows(Workout, workouts.results), parseRows(GroinCheck, checks.results), today);
  return all.filter((a) => a.date >= fromDate);
}

/** Alle knæ-til-væg-målinger med forskel mellem siderne (målet er 0). */
export async function getMobilityTrend(db: D1Database): Promise<MobilityPoint[]> {
  const { results } = await db.prepare('SELECT * FROM mobility_measurements WHERE deleted_at IS NULL').all<Record<string, unknown>>();
  return mobilityTrend(parseRows(MobilityMeasurement, results));
}
