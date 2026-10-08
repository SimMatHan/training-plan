// Trends for smerte (pr. monitor) og mobilitet (pr. test). Kaldes af API'et og MCP.
import type { MobilityTest, Monitor } from '../../shared/athletes';
import { mobilityTrend, type MobilityPoint } from '../../shared/mobility';
import { assessPain, type PainAssessment } from '../../shared/pain';
import type { MobilityMeasurement, Workout } from '../../shared/records.schema';
import { listMobilityTests, listMonitors } from './athletes';
import { readPainScores, readTable } from './history';

export interface PainTrend {
  monitor: Monitor;
  assessments: PainAssessment[];
}

/** Trafiklys pr. monitor og træning fra og med `fromDate` (YYYY-MM-DD). Inaktive monitors kun med `includeInactive`. */
export async function getPainTrend(
  db: D1Database,
  athleteId: number,
  fromDate: string,
  today = new Date().toISOString().slice(0, 10),
  opts: { includeInactive?: boolean } = {},
): Promise<PainTrend[]> {
  // Hele historikken vurderes, så "rød" (to i træk) kan afgøres for første træning i perioden.
  const [workouts, scores, monitors] = await Promise.all([
    readTable(db, athleteId, 'workouts', "deleted_at IS NULL AND type <> 'mobilitet'") as Promise<Workout[]>,
    readPainScores(db, athleteId),
    listMonitors(db, athleteId),
  ]);
  return monitors
    .filter((m) => m.active || opts.includeInactive)
    .map((monitor) => ({ monitor, assessments: assessPain(workouts, scores, monitor.id, today).filter((a) => a.date >= fromDate) }));
}

export interface MobilityTrend {
  test: MobilityTest;
  points: MobilityPoint[];
}

/** Målinger pr. mobilitetstest, ældste først. Tests pr. side har forskel venstre − højre. */
export async function getMobilityTrend(db: D1Database, athleteId: number, opts: { includeInactive?: boolean } = {}): Promise<MobilityTrend[]> {
  const [tests, measurements] = await Promise.all([
    listMobilityTests(db, athleteId),
    readTable(db, athleteId, 'mobility_measurements', 'deleted_at IS NULL') as Promise<MobilityMeasurement[]>,
  ]);
  return tests.filter((t) => t.active || opts.includeInactive).map((test) => ({ test, points: mobilityTrend(measurements, test) }));
}
