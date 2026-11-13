import { describe, expect, it } from 'vitest';
import { YogaRoutine, type MobilityItem } from '../shared/plan.schema';
import { doseTime, itemsDone, poseFromItem, routineFromMobility } from '../shared/mobilityRoutine';
import { buildSteps, poseSides } from '../shared/yoga';

describe('dosering → tid', () => {
  it.each([
    ['8 langsomme gentagelser', 40, false, true],
    ['30 sek pedalering + 30 sek hold', 60, false, false],
    ['40 sek pr. side, HØJRE fod forrest først', 40, true, false],
    ['40 sek pr. side', 40, true, false],
    ['60 sek', 60, false, false],
    ['90 sek', 90, false, false],
    ['2 × 8/side, 3 sek ned', 65, true, true],
    ['2 × 6/side, 2 sek hold', 35, true, true],
    ['2 × 15 sek, ca. 50 % kraft', 30, false, false],
    ['3 x 30 s/side', 90, true, false],
    ['2 min', 120, false, false],
    ['10 reps', 30, false, true],
    ['som du har lyst', 45, false, true],
  ])('%s', (dose, seconds, perSide, estimated) => {
    expect(doseTime(dose)).toEqual({ seconds, perSide, estimated });
  });

  it('holder tiden inden for det afspilleren tillader', () => {
    expect(doseTime('1 sek').seconds).toBe(10);
    expect(doseTime('20 min').seconds).toBe(600);
  });
});

const items: MobilityItem[] = [
  { id: 'yoga-kat-ko', name: 'Kat–ko på alle fire', dose: '8 langsomme gentagelser', cue: 'Ånd ind på ko, ud på kat.' },
  { id: 'yoga-lavt-udfald', name: 'Lavt udfald, knæ i gulvet', dose: '40 sek pr. side, HØJRE fod forrest først' },
  { id: 'daglig-dead-bug', name: 'Dead bug', dose: '2 × 8/side, 3 sek ned', cue: 'x'.repeat(400) },
];
const plan = { mobility: { name: 'Yoga + core', items, notes: [] } };

describe('mobilitetsblokken som rutine', () => {
  it('giver en gyldig rutine med punkterne i rækkefølge', () => {
    const routine = routineFromMobility(plan)!;
    expect(YogaRoutine.safeParse(routine).success).toBe(true);
    expect(routine.poses.map((p) => p.poseId)).toEqual(items.map((i) => i.id));
    expect(routine.poses[0]).toMatchObject({ name: 'Kat–ko på alle fire', seconds: 40, perSide: false, cue: '8 langsomme gentagelser. Ånd ind på ko, ud på kat.' });
  });

  it('tager ensidige punkter på begge sider, højre først', () => {
    const pose = poseFromItem(items[1]);
    expect(poseSides(pose).map((s) => s.side)).toEqual(['H', 'V']);
    expect(buildSteps({ areas: [], transitionSec: 3, poses: [pose] }).filter((s) => s.kind === 'stilling')).toHaveLength(2);
  });

  it('afkorter lange forklaringer', () => {
    expect(poseFromItem(items[2]).cue!.length).toBeLessThanOrEqual(300);
  });

  it('uden mobilitetsblok er der ingen rutine', () => {
    expect(routineFromMobility({ mobility: undefined })).toBeUndefined();
  });

  it('krydser de gennemførte punkter af', () => {
    expect(itemsDone(plan, 2, false)).toEqual(['yoga-kat-ko', 'yoga-lavt-udfald']);
    expect(itemsDone(plan, 0, true)).toEqual(items.map((i) => i.id));
  });
});
