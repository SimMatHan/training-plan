// Logikken bag det nye UI: kategorier til ikonfliser, vægttrin og talhjul, rekorder.
import { describe, expect, it } from 'vitest';
import planJson from '../plan/plan.v1.json';
import { PlanSchema } from '../shared/plan.schema';
import { categoryOf, exerciseCategory, sessionCategory } from '../src/logic/category';
import { bestScore, nearestIndex, setScore, weightStep, wheelValues } from '../src/logic/wheel';

const plan = PlanSchema.parse(planJson);

describe('kategorier', () => {
  it('følger fokusområdet, i den rigtige rækkefølge', () => {
    expect(categoryOf('Baglår, ryg')).toBe('legs');
    expect(categoryOf('Core, hofte')).toBe('core');
    expect(categoryOf('Øvre ryg')).toBe('back');
    expect(categoryOf('Postur')).toBe('back');
    expect(categoryOf('Skuldre')).toBe('arms');
    expect(categoryOf('Arme')).toBe('arms');
    expect(categoryOf('Højre achilles (soleus)')).toBe('calf');
    expect(categoryOf('Venstre lyske')).toBe('legs');
    expect(categoryOf(undefined, 'Sideplanke')).toBe('core');
    expect(categoryOf(undefined, 'Noget ukendt')).toBe('legs');
  });

  it('giver alle planens øvelser en kategori fra deres plads', () => {
    expect(exerciseCategory(plan, 'rdl')).toBe('legs');
    expect(exerciseCategory(plan, 'enbens-tahaev')).toBe('calf');
    expect(exerciseCategory(plan, 'face-pull')).toBe('back');
    expect(exerciseCategory(plan, 'biceps-curl')).toBe('arms');
    expect(exerciseCategory(plan, 'lat-pulldown')).toBe('back');
  });

  it('giver sessioner en kategori efter type', () => {
    expect(sessionCategory({ kind: 'løb', colorKey: 'run' })).toBe('cardio');
    expect(sessionCategory({ kind: 'mobilitet', colorKey: 'mobility' })).toBe('mobility');
    expect(sessionCategory({ kind: 'styrke', colorKey: 'B' })).toBe('back');
  });
});

describe('talhjul', () => {
  it('bruger 2,5 kg for stang og kabel, 0,5 kg ellers', () => {
    expect(weightStep({ name: 'Rumænsk dødløft (RDL)' })).toBe(2.5);
    expect(weightStep({ name: 'Hip thrust' })).toBe(2.5);
    expect(weightStep({ name: 'Lat pulldown' })).toBe(2.5);
    expect(weightStep({ name: 'Enbens RDL' })).toBe(0.5);
    expect(weightStep({ name: 'Enbens hip thrust' })).toBe(0.5);
    expect(weightStep({ name: 'Skulderpres, håndvægt' })).toBe(0.5);
  });

  it('har plads over værdien og sætter en skæv værdi ind', () => {
    const v = wheelValues({ value: 13.75, step: 2.5 });
    expect(v[0]).toBe(0);
    expect(v).toContain(13.75);
    expect(v.at(-1)).toBeGreaterThanOrEqual(40);
    expect(v).toEqual([...v].sort((a, b) => a - b));
    expect(wheelValues({ value: 60, step: 2.5 }).at(-1)).toBe(120);
    expect(wheelValues({ value: null, step: 1, floor: 5 })).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('finder nærmeste index', () => {
    expect(nearestIndex([null, 2.5, 5, 7.5], 6)).toBe(2);
    expect(nearestIndex([null, 2.5, 5], null)).toBe(0);
    expect(nearestIndex([1, 2, 3], null)).toBe(0);
  });
});

describe('rekorder', () => {
  it('scorer vægt × reps, reps eller sekunder', () => {
    expect(setScore({ weight_kg: 16, reps: 8, seconds: null }, 'weight_reps')).toBe(128);
    expect(setScore({ weight_kg: null, reps: 8, seconds: null }, 'bodyweight_reps')).toBe(8);
    expect(setScore({ weight_kg: null, reps: null, seconds: 30 }, 'time')).toBe(30);
    expect(bestScore([], 'time')).toBeNull();
    expect(
      bestScore(
        [
          { weight_kg: 16, reps: 8, seconds: null },
          { weight_kg: 18, reps: 6, seconds: null },
        ],
        'weight_reps',
      ),
    ).toBe(128);
  });
});
