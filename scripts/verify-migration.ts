// Afprøver fase 5-migrationen mod en kopi af produktionsdatabasen, lokalt og uden wrangler:
//
//   npx wrangler d1 export traeningsnav --remote --output backup-før-fase5.sql
//   npm run db:verify-migration -- backup-før-fase5.sql [--cleanup]
//
// Indlæser backuppen i SQLite (node:sqlite), tæller rækker og beregner lyske-trafiklysene med
// fase 1-reglen, kører de migrationer backuppen mangler (og med --cleanup også
// migrations-pending/), og tjekker at rækketal, trafiklysfarver, knee-to-wall og planversioner
// er uændrede — nu læst gennem de nye services. Fejler højlydt (exit 1) ved den mindste afvigelse.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { createTestD1, migrationFiles } from '../test/d1';
import { getPainTrend, getMobilityTrend } from '../worker/services/trends';
import { listPlanVersions } from '../worker/services/plan';

type Row = Record<string, unknown>;

/** Tabeller fra før fase 5, hvis rækker alle skal overleve. */
const TABLES = [
  'plan_versions',
  'workouts',
  'set_logs',
  'exercise_notes',
  'groin_checks',
  'mobility_measurements',
  'mobility_checks',
  'schedule_overrides',
  'coach_notes',
  'plan_proposals',
  'calendar_settings',
  'mcp_audit',
];

const nextDay = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);

/** Fase 1's lyske-trafiklys direkte på de gamle kolonner (workouts.groin_during, groin_checks). */
function oldLights(db: DatabaseSync, today: string): Record<string, string> {
  const workouts = db
    .prepare("SELECT uuid, date, started_at, groin_during FROM workouts WHERE deleted_at IS NULL AND type <> 'mobilitet' AND groin_during IS NOT NULL")
    .all() as { uuid: string; date: string; started_at: string | null; groin_during: number }[];
  const checks = db.prepare('SELECT date, morning_score, workout_uuid FROM groin_checks WHERE deleted_at IS NULL').all() as {
    date: string;
    morning_score: number;
    workout_uuid: string | null;
  }[];
  workouts.sort((a, b) => a.date.localeCompare(b.date) || (a.started_at ?? '').localeCompare(b.started_at ?? ''));
  const out: Record<string, string> = {};
  let prev: string | undefined;
  for (const w of workouts) {
    const morningDate = nextDay(w.date);
    const check = checks.find((c) => c.workout_uuid === w.uuid) ?? checks.find((c) => c.date === morningDate && !c.workout_uuid);
    const morning = check?.morning_score ?? null;
    let light = w.groin_during > 3 || (morning !== null && morning > 0) ? 'gul' : morning === 0 ? 'grøn' : today <= morningDate ? 'afventer' : 'ukendt';
    if (light === 'gul' && (prev === 'gul' || prev === 'rød')) light = 'rød';
    out[w.uuid] = `${w.groin_during}/${morning}/${light}`;
    prev = light;
  }
  return out;
}

const count = (db: DatabaseSync, table: string) => {
  try {
    return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
  } catch {
    return null; // tabellen findes ikke (fx groin_checks efter oprydningen)
  }
};

export interface Snapshot {
  counts: Record<string, number | null>;
  lights: Record<string, string>;
  kneeToWall: string[];
  planVersions: string[];
}

/** Tilstanden før migrationen, læst med de gamle kolonner. */
export function snapshotBefore(db: DatabaseSync, today: string): Snapshot {
  const counts = Object.fromEntries(TABLES.map((t) => [t, count(db, t)]));
  const ktw = db
    .prepare('SELECT date, knee_to_wall_right_cm AS r, knee_to_wall_left_cm AS l FROM mobility_measurements WHERE deleted_at IS NULL AND knee_to_wall_right_cm IS NOT NULL AND knee_to_wall_left_cm IS NOT NULL ORDER BY date, updated_at')
    .all() as { date: string; r: number; l: number }[];
  const versions = db.prepare('SELECT version, is_active, length(plan_json) AS n FROM plan_versions ORDER BY version').all() as Row[];
  return {
    counts,
    lights: oldLights(db, today),
    kneeToWall: ktw.map((m) => `${m.date}:${m.r}/${m.l}`),
    planVersions: versions.map((v) => `${v.version}:${v.is_active === 1}:${v.n}`),
  };
}

/** Tilstanden efter migrationen, læst gennem de nye services for atleten simon. */
export async function snapshotAfter(db: DatabaseSync, today: string): Promise<Snapshot> {
  const d1 = createTestD1(db);
  const simon = db.prepare("SELECT id FROM athletes WHERE slug = 'simon'").get() as { id: number } | undefined;
  if (!simon) throw new Error('Atleten simon findes ikke efter migrationen');
  const counts = Object.fromEntries(TABLES.map((t) => [t, count(db, t)]));
  // Efter oprydningen er groin_checks væk; morgenscorerne tælles i pain_scores.
  if (counts.groin_checks === null) counts.groin_checks = count(db, "pain_scores WHERE kind = 'morgen'");
  const lights: Record<string, string> = {};
  const [groin] = (await getPainTrend(d1, simon.id, '0000-01-01', today)).filter((t) => t.monitor.label === 'Venstre lyske');
  for (const a of groin?.assessments ?? []) lights[a.workoutUuid] = `${a.during}/${a.morning}/${a.light}`;
  const ktw = (await getMobilityTrend(d1, simon.id)).find((t) => t.test.name === 'Knee-to-wall');
  const versions = db.prepare('SELECT version, is_active, length(plan_json) AS n FROM plan_versions WHERE athlete_id = ? ORDER BY version').all(simon.id) as Row[];
  if ((await listPlanVersions(d1, simon.id)).length !== versions.length) throw new Error('listPlanVersions passer ikke med tabellen');
  return {
    counts,
    lights,
    kneeToWall: (ktw?.points ?? []).map((p) => `${p.date}:${p.right}/${p.left}`),
    planVersions: versions.map((v) => `${v.version}:${v.is_active === 1}:${v.n}`),
  };
}

/** Afvigelser mellem før og efter. Tom liste = alt passer. */
export function compareSnapshots(before: Snapshot, after: Snapshot): string[] {
  const problems: string[] = [];
  for (const t of TABLES)
    if (before.counts[t] !== after.counts[t]) problems.push(`${t}: ${before.counts[t]} rækker før, ${after.counts[t]} efter`);
  const uuids = new Set([...Object.keys(before.lights), ...Object.keys(after.lights)]);
  for (const u of uuids)
    if (before.lights[u] !== after.lights[u]) problems.push(`trafiklys for træning ${u}: ${before.lights[u] ?? '(mangler)'} før, ${after.lights[u] ?? '(mangler)'} efter`);
  if (before.kneeToWall.join() !== after.kneeToWall.join()) problems.push(`knee-to-wall: ${before.kneeToWall.join(', ')} før, ${after.kneeToWall.join(', ')} efter`);
  if (before.planVersions.join() !== after.planVersions.join()) problems.push(`planversioner: ${before.planVersions.join(', ')} før, ${after.planVersions.join(', ')} efter`);
  return problems;
}

/** Kører de migrationer databasen mangler (efter navn i d1_migrations), og evt. oprydningen. */
export function applyPending(db: DatabaseSync, opts: { cleanup?: boolean } = {}): string[] {
  let applied = new Set<string>();
  try {
    applied = new Set((db.prepare('SELECT name FROM d1_migrations').all() as { name: string }[]).map((r) => r.name));
  } catch {
    // Ingen d1_migrations: antag at intet er kørt efter fase 3, dvs. 0001–0005.
    applied = new Set(migrationFiles().map((m) => m.name).filter((n) => n < '0006'));
  }
  const run = migrationFiles().filter((m) => !applied.has(m.name));
  if (opts.cleanup) run.push(...migrationFiles('migrations-pending'));
  for (const m of run) db.exec(m.sql);
  return run.map((m) => m.name);
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Brug: npm run db:verify-migration -- <backup.sql> [--cleanup]');
    process.exit(1);
  }
  const today = new Date().toISOString().slice(0, 10);
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(file, 'utf8'));
  const before = snapshotBefore(db, today);
  console.log('Før:', before.counts, `${Object.keys(before.lights).length} trafiklys, ${before.kneeToWall.length} knee-to-wall-målinger`);
  const ran = applyPending(db, { cleanup: process.argv.includes('--cleanup') });
  console.log('Kørte:', ran.join(', ') || '(ingen)');
  const after = await snapshotAfter(db, today);
  console.log('Efter:', after.counts, `${Object.keys(after.lights).length} trafiklys, ${after.kneeToWall.length} knee-to-wall-målinger`);
  const problems = compareSnapshots(before, after);
  if (problems.length) {
    console.error(`\n\x1b[31m✗ MIGRATIONEN PASSER IKKE (${problems.length} afvigelser):\x1b[0m`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('\n\x1b[32m✓ Rækketal, trafiklysfarver, knee-to-wall og planversioner er uændrede.\x1b[0m');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
