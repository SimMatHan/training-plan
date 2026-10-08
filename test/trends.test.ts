import { describe, expect, it } from 'vitest';
import { measurementDue, mobilityTrend } from '../shared/mobility';
import { assessAllPain, assessPain, parseGate, pendingMorningChecks, worstByWorkout } from '../shared/pain';
import { MobilityMeasurement, PainScore, Workout, type PainScore as PS, type Workout as W } from '../shared/records.schema';
import { getMobilityTrend, getPainTrend } from '../worker/services/trends';
import { pushChanges } from '../worker/services/sync';
import { createSeededD1 } from './d1';

const ts = '2026-10-01T10:00:00.000Z';
let n = 0;
const id = () => `30000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const LYSKE = 1;
const KNAE = 2;

const workout = (date: string, extra: Partial<W> = {}): W =>
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
    source: 'app',
    external_id: null,
    distance_km: null,
    duration_sec: null,
    avg_hr: null,
    updated_at: ts,
    ...extra,
  });

const under = (w: W, score: number, monitor = LYSKE): PS =>
  PainScore.parse({ uuid: id(), monitor_id: monitor, workout_uuid: w.uuid, date: w.date, kind: 'under', score, updated_at: ts });
const morning = (date: string, score: number, w: W | null = null, monitor = LYSKE): PS =>
  PainScore.parse({ uuid: id(), monitor_id: monitor, workout_uuid: w?.uuid ?? null, date, kind: 'morgen', score, updated_at: ts });

describe('smerte-trafiklys pr. monitor', () => {
  it('grøn: ≤ 3 under og 0 næste morgen', () => {
    const w = workout('2026-10-05');
    const [a] = assessPain([w], [under(w, 3), morning('2026-10-06', 0, w)], LYSKE, '2026-10-07');
    expect(a.light).toBe('grøn');
  });

  it('gul: over 3 under, eller ikke væk næste morgen; rød ved to i træk', () => {
    const w1 = workout('2026-10-05');
    const w2 = workout('2026-10-08');
    const res = assessPain([w1, w2], [under(w1, 4), under(w2, 1), morning('2026-10-06', 0, w1), morning('2026-10-09', 1, w2)], LYSKE, '2026-10-10');
    expect(res.map((r) => r.light)).toEqual(['gul', 'rød']);
  });

  it('rød kun ved to ikke-grønne i træk', () => {
    const [a, b, c] = [workout('2026-10-01'), workout('2026-10-03'), workout('2026-10-05')];
    const res = assessPain([a, b, c], [under(a, 5), under(b, 2), under(c, 5), morning('2026-10-04', 0, b)], LYSKE, '2026-10-10');
    expect(res.map((r) => r.light)).toEqual(['gul', 'grøn', 'gul']);
  });

  it('afventer morgenscore til dagen efter, derefter ukendt; morgenscore uden træning bruges også', () => {
    const w = workout('2026-10-05');
    expect(assessPain([w], [under(w, 2)], LYSKE, '2026-10-06')[0].light).toBe('afventer');
    expect(assessPain([w], [under(w, 2)], LYSKE, '2026-10-07')[0].light).toBe('ukendt');
    expect(assessPain([w], [under(w, 2), morning('2026-10-06', 0)], LYSKE, '2026-10-07')[0].light).toBe('grøn');
  });

  it('ignorerer mobilitet, slettede træninger og træninger uden score for monitoren', () => {
    const a = workout('2026-10-05');
    const b = workout('2026-10-05', { type: 'mobilitet' });
    const c = workout('2026-10-05', { deleted_at: ts });
    expect(assessPain([a, b, c], [under(a, 2, KNAE), under(b, 2), under(c, 2)], LYSKE, '2026-10-06')).toHaveLength(0);
  });

  it('reglen gælder pr. monitor; det værste lys vises pr. træning', () => {
    const w = workout('2026-10-05');
    const scores = [under(w, 1), under(w, 6, KNAE), morning('2026-10-06', 0, w), morning('2026-10-06', 0, w, KNAE)];
    const all = assessAllPain([w], scores, [LYSKE, KNAE], '2026-10-07');
    expect(all.map((a) => [a.monitorId, a.light])).toEqual([
      [LYSKE, 'grøn'],
      [KNAE, 'gul'],
    ]);
    expect(worstByWorkout(all).get(w.uuid)?.light).toBe('gul');
  });

  it('morgenspørgsmålet gælder gårsdagens træning pr. monitor og forsvinder når det er besvaret', () => {
    const w = workout('2026-10-05');
    const scores = [under(w, 2), under(w, 1, KNAE)];
    expect(pendingMorningChecks([w], scores, [LYSKE, KNAE], '2026-10-06').map((p) => p.monitorId)).toEqual([LYSKE, KNAE]);
    expect(pendingMorningChecks([w], [...scores, morning('2026-10-06', 0, w)], [LYSKE, KNAE], '2026-10-06').map((p) => p.monitorId)).toEqual([KNAE]);
    expect(pendingMorningChecks([w], scores, [LYSKE], '2026-10-07')).toEqual([]);
  });

  it('læser porten efter rehab', () => {
    expect(parseGate('Port til uge 5: grønt i uge 3 og 4. Er det gult, gentages uge 4.')).toEqual({ toWeek: 5, weeks: [3, 4] });
    expect(parseGate(undefined)).toBeUndefined();
  });
});

describe('mobilitetstests', () => {
  const m = (date: string, right: number | null, left: number | null, value: number | null = null, test_id = 1) =>
    MobilityMeasurement.parse({ uuid: id(), test_id, date, value_right: right, value_left: left, value, note: null, updated_at: ts });

  it('regner forskel (venstre − højre) for tests pr. side og påmindelse efter 14 dage', () => {
    const points = mobilityTrend([m('2026-10-11', 6, 7), m('2026-09-27', 5, 7), m('2026-10-01', null, null, 3, 2)], { id: 1, per_side: true });
    expect(points.map((p) => p.diff)).toEqual([2, 1]);
    expect(measurementDue(points, '2026-10-24', 14)).toMatchObject({ due: false, days: 13 });
    expect(measurementDue(points, '2026-10-25', 14)).toMatchObject({ due: true, days: 14 });
    expect(measurementDue([], '2026-10-25', 14).due).toBe(true);
  });

  it('tests uden sider bruger value', () => {
    const points = mobilityTrend([m('2026-10-01', null, null, 12.5, 2), m('2026-10-02', 1, 2, null, 2)], { id: 2, per_side: false });
    expect(points.map((p) => [p.value, p.diff])).toEqual([[12.5, null]]);
  });
});

describe('trend-services (uden HTTP)', () => {
  it('getMobilityTrend indeholder knee-to-wall-baseline fra seed', async () => {
    const db = await createSeededD1();
    const [ktw] = await getMobilityTrend(db, 1);
    expect(ktw.test).toMatchObject({ name: 'Knee-to-wall', unit: 'cm', per_side: true });
    expect(ktw.points).toMatchObject([{ date: '2026-09-27', right: 5, left: 7, diff: 2 }]);
  });

  it('getPainTrend vurderer synkede træninger pr. monitor', async () => {
    const db = await createSeededD1();
    const monitor = (await db.prepare("SELECT id FROM monitors WHERE label = 'Venstre lyske'").first<number>('id'))!;
    const w = workout('2026-10-05');
    await pushChanges(db, 1, { workouts: [w], pain_scores: [under(w, 2, monitor), morning('2026-10-06', 0, w, monitor)] });
    const [trend] = await getPainTrend(db, 1, '2026-10-01', '2026-10-07');
    expect(trend.monitor.label).toBe('Venstre lyske');
    expect(trend.assessments).toMatchObject([{ workoutUuid: w.uuid, during: 2, morning: 0, light: 'grøn' }]);
    expect((await getPainTrend(db, 1, '2026-10-06', '2026-10-07'))[0].assessments).toHaveLength(0);
  });

  it('virker også efter oprydningsmigrationen', async () => {
    const db = await createSeededD1({ cleanup: true });
    expect((await getMobilityTrend(db, 1))[0].points).toHaveLength(1);
    const w = workout('2026-10-05');
    await pushChanges(db, 1, { workouts: [w], pain_scores: [under(w, 5, 1)] });
    expect((await getPainTrend(db, 1, '2026-10-01', '2026-10-07'))[0].assessments[0].light).toBe('gul');
  });
});
