// Fase 5-migrationen (0006) mod en database som produktionen før fase 5: rækketal,
// lyske-trafiklys, knee-to-wall og planversioner skal være uændrede, og alt tilhører simon.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import planJson from '../plan/plan.v1.json';
import { applyPending, compareSnapshots, snapshotAfter, snapshotBefore } from '../scripts/verify-migration';
import { createTestD1, migrationFiles } from './d1';
import { getActivePlan } from '../worker/services/plan';
import { pullChanges } from '../worker/services/sync';

const TODAY = '2026-10-20';
const T = '2026-10-05T18:00:00.000Z';
const u = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** En database som før fase 5: migrationer 0001–0005 og data i de gamle kolonner. */
function productionBefore(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT)`);
  for (const m of migrationFiles().filter((m) => m.name < '0006')) {
    db.exec(m.sql);
    db.prepare('INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)').run(m.name, T);
  }
  const plan = JSON.stringify(planJson);
  db.prepare(`INSERT INTO plan_versions (version, created_at, source, note, plan_json, is_active) VALUES (1, ?, 'seed', 'v1', ?, 0)`).run(T, plan);
  db.prepare(`INSERT INTO plan_versions (version, created_at, source, note, plan_json, is_active, based_on_version, activated_at) VALUES (2, ?, 'claude', 'v2', ?, 1, 1, ?)`).run(T, plan, T);
  const workout = db.prepare(
    `INSERT INTO workouts (uuid, planned_session_id, plan_version, week_no, date, started_at, finished_at, type, groin_during, source, updated_at, deleted_at, server_updated_at) VALUES (?, ?, 2, ?, ?, ?, ?, ?, ?, 'app', ?, ?, ?)`,
  );
  // Grøn, gul, rød, ukendt, en slettet, en mobilitetsdag og en uden lyske.
  workout.run(u(1), 'rehab-a', 2, '2026-10-05', '2026-10-05T16:00:00.000Z', T, 'styrke', 2, T, null, T);
  workout.run(u(2), 'rh', 2, '2026-10-07', '2026-10-07T16:00:00.000Z', T, 'løb', 5, T, null, T);
  workout.run(u(3), 'rehab-b', 2, '2026-10-08', '2026-10-08T16:00:00.000Z', T, 'styrke', 1, T, null, T);
  workout.run(u(4), 'ct', 2, '2026-10-10', '2026-10-10T16:00:00.000Z', T, 'cardio', 3, T, null, T);
  workout.run(u(5), 'rehab-a', 3, '2026-10-12', '2026-10-12T16:00:00.000Z', T, 'styrke', 7, T, T, T);
  workout.run(u(6), 'mobilitet', 3, '2026-10-12', '2026-10-12T07:00:00.000Z', T, 'mobilitet', null, T, null, T);
  workout.run(u(7), null, 3, '2026-10-13', '2026-10-13T07:00:00.000Z', T, 'cardio', null, T, null, T);
  const check = db.prepare(`INSERT INTO groin_checks (uuid, date, morning_score, workout_uuid, updated_at, deleted_at, server_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  check.run(u(11), '2026-10-06', 0, u(1), T, null, T);
  check.run(u(12), '2026-10-09', 2, null, T, null, T); // uden træning: gælder rehab-b dagen før
  check.run(u(13), '2026-10-01', 0, null, T, T, T); // slettet
  const m = db.prepare(`INSERT INTO mobility_measurements (uuid, date, knee_to_wall_right_cm, knee_to_wall_left_cm, note, updated_at, server_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  m.run(u(21), '2026-09-27', 5, 7, 'baseline', T, T);
  m.run(u(22), '2026-10-11', 6, 7, null, T, T);
  db.prepare(`INSERT INTO set_logs (uuid, workout_uuid, exercise_id, set_no, side, weight_kg, reps, done, updated_at, server_updated_at) VALUES (?, ?, 'enbens-rdl', 1, 'H', 16, 8, 1, ?, ?)`).run(u(31), u(1), T, T);
  db.prepare(`INSERT INTO exercise_notes (uuid, workout_uuid, exercise_id, note, rpe, updated_at, server_updated_at) VALUES (?, ?, 'enbens-rdl', 'ok', 6, ?, ?)`).run(u(32), u(1), T, T);
  db.prepare(`INSERT INTO mobility_checks (uuid, workout_uuid, item_id, done, updated_at, server_updated_at) VALUES (?, ?, 'x', 1, ?, ?)`).run(u(33), u(6), T, T);
  db.prepare(`INSERT INTO schedule_overrides (uuid, week_no, session_id, day, updated_at, server_updated_at) VALUES (?, 3, 'rh', 2, ?, ?)`).run(u(34), T, T);
  db.prepare(`INSERT INTO coach_notes (uuid, created_at, week_no, text, updated_at, server_updated_at) VALUES (?, ?, 2, 'Godt', ?, ?)`).run(u(35), T, T, T);
  db.prepare(`INSERT INTO plan_proposals (uuid, created_at, base_version, summary, rationale, patch_json, status) VALUES (?, ?, 1, 'Gammel', 'x', '[]', 'forældet')`).run(u(36), T);
  db.prepare(`INSERT INTO calendar_settings (session_type, all_day, start_time, duration_min, updated_at) VALUES ('løb', 0, '07:00', 60, ?)`).run(T);
  db.prepare(`INSERT INTO mcp_audit (at, tool, ok) VALUES (?, 'hent_status', 1)`).run(T);
  return db;
}

describe('fase 5-migrationen', () => {
  it('bevarer rækketal, trafiklysfarver, knee-to-wall og planversioner', async () => {
    const db = productionBefore();
    const before = snapshotBefore(db, TODAY);
    expect(Object.values(before.lights).map((l) => l.split('/')[2])).toEqual(['grøn', 'gul', 'rød', 'ukendt']);
    expect(applyPending(db)).toEqual(['0006_atleter.sql']);
    const after = await snapshotAfter(db, TODAY);
    expect(compareSnapshots(before, after)).toEqual([]);

    const d1 = createTestD1(db);
    expect((await getActivePlan(d1, 1)).meta).toMatchObject({ version: 2, source: 'claude' });
    const { changes } = await pullChanges(d1, 1, null);
    expect(changes.workouts).toHaveLength(7);
    expect(changes.pain_scores).toHaveLength(8);
    expect(changes.mobility_measurements?.map((m) => [m.value_right, m.value_left])).toEqual([
      [5, 7],
      [6, 7],
    ]);
    const tables = ['workouts', 'set_logs', 'exercise_notes', 'mobility_checks', 'mobility_measurements', 'schedule_overrides', 'coach_notes', 'plan_proposals', 'plan_versions', 'calendar_settings'];
    for (const t of tables) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE athlete_id <> 1`).get()).toEqual({ n: 0 });
    // Instruktionen til testen kommer fra den aktive plan.
    expect((db.prepare("SELECT instructions FROM mobility_tests WHERE name = 'Knee-to-wall'").get() as { instructions: string }).instructions).toBe(
      planJson.mobility.measurement.instructions,
    );
  });

  it('oprydningen fjerner de gamle kolonner uden at ændre noget', async () => {
    const db = productionBefore();
    const before = snapshotBefore(db, TODAY);
    applyPending(db, { cleanup: true });
    expect(compareSnapshots(before, await snapshotAfter(db, TODAY))).toEqual([]);
    const cols = (db.prepare('PRAGMA table_info(workouts)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain('groin_during');
    expect(() => db.prepare('SELECT 1 FROM groin_checks').get()).toThrow();
  });

  it('fejler højlydt ved en afvigelse', async () => {
    const db = productionBefore();
    const before = snapshotBefore(db, TODAY);
    applyPending(db);
    db.exec(`UPDATE pain_scores SET score = 9 WHERE uuid = '${u(1)}'`);
    expect(compareSnapshots(before, await snapshotAfter(db, TODAY))).toContainEqual(`trafiklys for træning ${u(1)}: 2/0/grøn før, 9/0/gul efter`);
  });
});
