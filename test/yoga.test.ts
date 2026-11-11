import { beforeEach, describe, expect, it } from 'vitest';
import { PlanSchema, type Plan } from '../shared/plan.schema';
import {
  areaForTest,
  buildSteps,
  buildYogaRoutine,
  cuesFor,
  insightsFromTests,
  pickYogaDays,
  positionAt,
  poseSides,
  routineSeconds,
  skipTarget,
  YOGA_AREAS,
  AREA_POSES,
  YOGA_POSES,
  catalogPose,
} from '../shared/yoga';
import { illustrationFor } from '../src/logic/illustrations';
import { callTool } from '../worker/mcp/tools';
import { getAthlete } from '../worker/services/athletes';
import { getActivePlan } from '../worker/services/plan';
import { approveProposal } from '../worker/services/proposals';
import { createWorld, type World } from './world';

describe('rutinegenerator', () => {
  it('rammer tiden inden for et halvt minut', () => {
    for (const minutes of [5, 10, 15, 20, 30, 45, 60])
      for (const areas of [[], ['hofter'], ['ankler', 'baglaar', 'skuldre']] as const) {
        const r = buildYogaRoutine({ minutes, areas: [...areas] });
        expect(Math.abs(routineSeconds(r) - minutes * 60), `${minutes} min ${areas}`).toBeLessThanOrEqual(30);
      }
  });

  it('starter med åbning, slutter med hvilestilling og tager fokusområderne først', () => {
    const r = buildYogaRoutine({ minutes: 20, areas: ['ankler', 'hofter'] });
    const ids = r.poses.map((p) => p.poseId);
    expect(ids.slice(0, 2)).toEqual(['barnets-stilling', 'kat-ko']);
    expect(ids.at(-1)).toBe('savasana');
    expect(ids.slice(2, 4)).toEqual(['ankel-udfald', 'due']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('giver den stramme side længere tid og tager den først', () => {
    const r = buildYogaRoutine({ minutes: 20, areas: ['ankler'], tight: { ankler: 'V' } });
    const ankle = r.poses.find((p) => p.poseId === 'ankel-udfald')!;
    const sides = poseSides(ankle);
    expect(sides[0].side).toBe('V');
    expect(sides[0].seconds).toBeGreaterThan(sides[1].seconds);
  });

  it('er en gyldig del af en plan', () => {
    const r = buildYogaRoutine({ minutes: 15, areas: ['lyske'] });
    expect(r.poses.every((p) => catalogPose(p.poseId))).toBe(true);
  });
});

describe('katalog', () => {
  it('har stillinger til alle områder, og alle id’er findes', () => {
    for (const a of YOGA_AREAS) {
      expect(AREA_POSES[a].length, a).toBeGreaterThan(0);
      for (const id of AREA_POSES[a]) expect(catalogPose(id)?.areas, `${a}: ${id}`).toContain(a);
    }
    expect(new Set(YOGA_POSES.map((p) => p.id)).size).toBe(YOGA_POSES.length);
  });

  it('har en figur til hver stilling', () => {
    expect(YOGA_POSES.filter((p) => !illustrationFor(p.id, p.name)).map((p) => p.id)).toEqual([]);
  });
});

describe('tidslinje og lyde', () => {
  const routine = {
    areas: [],
    transitionSec: 6,
    poses: [
      { poseId: 'kat-ko', seconds: 30 },
      { poseId: 'due', seconds: 60, sideSeconds: { V: 90 } },
    ],
  };
  const steps = buildSteps(routine);

  it('har klar, stilling, overgang og skift i rækkefølge', () => {
    expect(steps.map((s) => [s.kind, s.poseIndex, s.side, s.seconds])).toEqual([
      ['klar', 0, null, 10],
      ['stilling', 0, null, 30],
      ['overgang', 1, 'V', 6],
      ['stilling', 1, 'V', 90],
      ['skift', 1, 'H', 5],
      ['stilling', 1, 'H', 60],
    ]);
    expect(routineSeconds(routine)).toBe(201);
  });

  it('finder positionen og springer mellem stillinger', () => {
    expect(positionAt(steps, 0)).toMatchObject({ index: 0, remainingMs: 10_000 });
    expect(positionAt(steps, 45_000)).toMatchObject({ index: 2, remainingMs: 1_000 });
    expect(positionAt(steps, 999_000)).toMatchObject({ done: true });
    expect(skipTarget(steps, 12_000, 1)).toBe(46_000);
    expect(skipTarget(steps, 50_000, -1)).toBe(46_000);
    expect(skipTarget(steps, 47_000, -1)).toBe(10_000);
  });

  it('har lyd ved skift, næste stilling, nedtælling og slut', () => {
    const cues = cuesFor(routine, steps);
    expect(cues.filter((c) => c.sound === 'skift')).toEqual([{ atMs: 136_000, sound: 'skift', say: 'Skift side' }]);
    expect(cues.find((c) => c.sound === 'naeste')?.say).toBe('Næste: Due. Venstre side');
    expect(cues.filter((c) => c.sound === 'tick').map((c) => c.atMs)).toEqual([7_000, 8_000, 9_000, 43_000, 44_000, 45_000, 138_000, 139_000, 140_000]);
    expect(cues.filter((c) => c.sound === 'halvvejs').map((c) => c.atMs)).toEqual([91_000, 171_000]);
    expect(cues.at(-1)).toMatchObject({ atMs: 201_000, sound: 'faerdig' });
  });
});

describe('mobilitetstests og dage', () => {
  it('kender områderne', () => {
    expect(areaForTest('Knee-to-wall')).toBe('ankler');
    expect(areaForTest('Thomas test')).toBe('hoftebojere');
    expect(areaForTest('Sit and reach')).toBe('baglaar');
    expect(areaForTest('Hofte intern rotation')).toBe('hofter');
    expect(areaForTest('Noget')).toBeUndefined();
  });

  it('finder den stramme side', () => {
    const [i] = insightsFromTests([{ name: 'Knee-to-wall', unit: 'cm', per_side: true, active: true, last: { right: 5, left: 7, value: null } }]);
    expect(i).toMatchObject({ area: 'ankler', tightSide: 'H' });
    const [j] = insightsFromTests([{ name: 'Knee-to-wall', unit: 'cm', per_side: true, active: true, last: { right: 7, left: 7.2, value: null } }]);
    expect(j.tightSide).toBeUndefined();
  });

  it('fordeler dagene jævnt og helst uden om tunge dage', () => {
    const week = { sessions: [1, 3, 5].map((day) => ({ sessionId: 's', day, label: '', optional: false })) };
    expect(pickYogaDays(week, 3)).toEqual([2, 4, 6]);
    expect(pickYogaDays(week, 1)).toEqual([2]);
    expect(pickYogaDays(week, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('foreslaa_yogarutine (MCP)', () => {
  let w: World;
  const NOW = new Date('2026-10-07T10:00:00.000Z');
  beforeEach(async () => {
    w = await createWorld();
  });
  const call = async (name: string, args: unknown) => {
    const r = await callTool({ db: w.db, now: NOW, athlete: await getAthlete(w.db, w.simon.athleteId), userId: w.simon.userId, role: 'ejer' }, name, args);
    return { ...r, json: JSON.parse(r.text) };
  };

  it('laver et forslag med rutinen fra denne uge, og godkendt står den i planen', async () => {
    const r = await call('foreslaa_yogarutine', { minutter: 20, omraader: ['hofter'], gangePrUge: 2, rationale: 'Stive hofter efter løb.' });
    expect(r.ok, r.text).toBe(true);
    expect(r.json.rutine.minutter).toBe(20);
    expect(r.json.uger).toBe('2–14');
    // Knee-to-wall (højre 5, venstre 7) giver ankler og ekstra tid på højre side.
    expect(r.json.fraMobilitetstests[0]).toContain('højre side er strammest');
    expect(r.json.rutine.stillinger.some((s: string) => s.startsWith('Knæ over tå') && s.includes('højre'))).toBe(true);
    expect(r.json.diff[0]).toMatch(/^Ny session: Yoga · hofter og ankler \(20 min/);

    await approveProposal(w.db, w.simon.athleteId, r.json.id);
    const { plan } = await getActivePlan(w.db, w.simon.athleteId);
    expect(PlanSchema.safeParse(plan).success).toBe(true);
    const session = plan.sessions.find((s) => s.id === 'yoga')!;
    expect(session).toMatchObject({ kind: 'mobilitet', colorKey: 'mobility', durationMin: { min: 20, max: 20 } });
    const count = (p: Plan, weekNo: number) => p.weeks.find((x) => x.weekNo === weekNo)!.sessions.filter((s) => s.sessionId === 'yoga').length;
    expect(count(plan, 1)).toBe(0);
    expect(count(plan, 2)).toBe(2);
    expect(count(plan, 14)).toBe(2);

    // Ændret: samme session med faste dage og en egen rækkefølge.
    const again = await call('foreslaa_yogarutine', {
      sessionId: 'yoga',
      gangePrUge: 1,
      dage: [3, 7],
      brugTests: false,
      stillinger: [
        { poseId: 'due', sekunder: 60, venstreSek: 90 },
        { poseId: 'savasana', sekunder: 120 },
      ],
      rationale: 'Kortere.',
    });
    expect(again.ok, again.text).toBe(true);
    expect(again.json.dage).toBe('ons, søn');
    expect(again.json.rutine.stillinger[0]).toBe('Due 60 s/side (venstre 90 s, tages først)');
    expect(again.json.diff.join('\n')).toContain('yogarutine');
  });

  it('afviser ukendte stillinger uden navn og en manglende varighed', async () => {
    expect((await call('foreslaa_yogarutine', { gangePrUge: 2, rationale: 'x' })).json.fejl).toContain('minutter');
    expect((await call('foreslaa_yogarutine', { gangePrUge: 2, rationale: 'x', stillinger: [{ poseId: 'ukendt', sekunder: 30 }] })).json.fejl).toContain('list_yogastillinger');
  });

  it('list_yogastillinger filtrerer på område', async () => {
    const r = await call('list_yogastillinger', { omraade: 'ankler' });
    expect(r.json.stillinger.map((s: { poseId: string }) => s.poseId)).toEqual(['nedadgaaende-hund', 'malasana', 'ankel-udfald', 'diamantsiddende']);
  });
});
