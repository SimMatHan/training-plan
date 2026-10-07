import { describe, expect, it } from 'vitest';
import { assessGroin, parseGate, pendingMorningCheck } from '../shared/groin';
import { measurementDue, mobilityTrend } from '../shared/mobility';
import { GroinCheck, MobilityMeasurement, Workout, type GroinCheck as GC, type Workout as W } from '../shared/records.schema';
import { getGroinTrend, getMobilityTrend } from '../worker/services/trends';
import { pushChanges } from '../worker/services/sync';
import { createSeededD1 } from './d1';

const ts = '2026-10-01T10:00:00.000Z';
let n = 0;
const id = () => `30000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const workout = (date: string, during: number | null, extra: Partial<W> = {}): W =>
  Workout.parse({
    uuid: id(),
    planned_session_id: 'rehab-a',
    plan_version: 1,
    week_no: 1,
    date,
    started_at: `${date}T16:00:00.000Z`,
    finished_at: `${date}T17:00:00.000Z`,
    type: 'styrke',
    rpe: null,
    note: null,
    groin_during: during,
    source: 'app',
    external_id: null,
    distance_km: null,
    duration_sec: null,
    avg_hr: null,
    updated_at: ts,
    ...extra,
  });

const check = (date: string, morning: number, workout_uuid: string | null = null): GC =>
  GroinCheck.parse({ uuid: id(), date, morning_score: morning, workout_uuid, updated_at: ts });

describe('lyske-trafiklys', () => {
  it('grøn: ≤ 3 under og 0 næste morgen', () => {
    const w = workout('2026-10-05', 3);
    const [a] = assessGroin([w], [check('2026-10-06', 0, w.uuid)], '2026-10-07');
    expect(a.light).toBe('grøn');
  });

  it('gul: over 3 under, eller ikke væk næste morgen', () => {
    const w1 = workout('2026-10-05', 4);
    const w2 = workout('2026-10-08', 1);
    const res = assessGroin([w1, w2], [check('2026-10-06', 0, w1.uuid), check('2026-10-09', 1, w2.uuid)], '2026-10-10');
    expect(res.map((r) => r.light)).toEqual(['gul', 'rød']);
  });

  it('rød kun ved to ikke-grønne i træk', () => {
    const [a, b, c] = [workout('2026-10-01', 5), workout('2026-10-03', 2), workout('2026-10-05', 5)];
    const res = assessGroin([a, b, c], [check('2026-10-04', 0, b.uuid)], '2026-10-10');
    expect(res.map((r) => r.light)).toEqual(['gul', 'grøn', 'gul']);
  });

  it('afventer morgenscore til dagen efter, derefter ukendt', () => {
    const w = workout('2026-10-05', 2);
    expect(assessGroin([w], [], '2026-10-06')[0].light).toBe('afventer');
    expect(assessGroin([w], [], '2026-10-07')[0].light).toBe('ukendt');
  });

  it('ignorerer mobilitet, slettede og træninger uden under-score', () => {
    const res = assessGroin(
      [workout('2026-10-05', null), workout('2026-10-05', 2, { type: 'mobilitet' }), workout('2026-10-05', 2, { deleted_at: ts })],
      [],
      '2026-10-06',
    );
    expect(res).toHaveLength(0);
  });

  it('morgenspørgsmålet gælder gårsdagens træning og forsvinder når det er besvaret', () => {
    const w = workout('2026-10-05', 2);
    expect(pendingMorningCheck([w], [], '2026-10-06')?.uuid).toBe(w.uuid);
    expect(pendingMorningCheck([w], [check('2026-10-06', 0, w.uuid)], '2026-10-06')).toBeUndefined();
    expect(pendingMorningCheck([w], [], '2026-10-07')).toBeUndefined();
  });

  it('læser porten efter rehab', () => {
    expect(parseGate('Port til uge 5: grønt i uge 3 og 4. Er det gult, gentages uge 4.')).toEqual({ toWeek: 5, weeks: [3, 4] });
    expect(parseGate(undefined)).toBeUndefined();
  });
});

describe('ankelmobilitet', () => {
  const m = (date: string, right: number, left: number) =>
    MobilityMeasurement.parse({ uuid: id(), date, knee_to_wall_right_cm: right, knee_to_wall_left_cm: left, note: null, updated_at: ts });

  it('regner forskel (venstre − højre) og påmindelse efter 14 dage', () => {
    const points = mobilityTrend([m('2026-10-11', 6, 7), m('2026-09-27', 5, 7)]);
    expect(points.map((p) => p.diff)).toEqual([2, 1]);
    expect(measurementDue(points, '2026-10-24', 14)).toMatchObject({ due: false, days: 13 });
    expect(measurementDue(points, '2026-10-25', 14)).toMatchObject({ due: true, days: 14 });
    expect(measurementDue([], '2026-10-25', 14).due).toBe(true);
  });
});

describe('trend-services (uden HTTP)', () => {
  it('getMobilityTrend indeholder baseline fra seed', async () => {
    const db = await createSeededD1();
    expect(await getMobilityTrend(db)).toMatchObject([{ date: '2026-09-27', right: 5, left: 7, diff: 2 }]);
  });

  it('getGroinTrend vurderer synkede træninger', async () => {
    const db = await createSeededD1();
    const w = workout('2026-10-05', 2);
    await pushChanges(db, { workouts: [w], groin_checks: [check('2026-10-06', 0, w.uuid)] });
    const trend = await getGroinTrend(db, '2026-10-01', '2026-10-07');
    expect(trend).toMatchObject([{ workoutUuid: w.uuid, during: 2, morning: 0, light: 'grøn' }]);
    expect(await getGroinTrend(db, '2026-10-06', '2026-10-07')).toHaveLength(0);
  });
});
