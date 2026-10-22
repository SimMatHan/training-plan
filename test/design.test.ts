// Logikken bag det nye UI: kategorier til ikonfliser, vægttrin og talhjul, rekorder.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import planJson from '../plan/plan.v1.json';
import { PlanSchema } from '../shared/plan.schema';
import { resolveStrengthSession } from '../shared/resolve';
import { CATEGORY_LABEL, categoryOf, exerciseCategory, sessionCategory, type Category } from '../src/logic/category';
import { blend, LEN, pingPong, solve } from '../src/logic/figure';
import { ILLUSTRATIONS, illustrationFor } from '../src/logic/illustrations';
import { roundTarget, sidesDiffer, toRounds } from '../src/logic/rounds';
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
    expect(sessionCategory({ kind: 'styrke', colorKey: 'A' })).toBe('legs');
    expect(sessionCategory({ kind: 'styrke', colorKey: 'C' })).toBe('strength-c');
    expect(sessionCategory({ kind: 'styrke', colorKey: 'D' })).toBe('strength-d');
  });

  it('har en farve-token for hver kategori i lys, mørk (system) og mørk (tvunget)', () => {
    const css = readFileSync(path.resolve(import.meta.dirname, '../src/styles/tokens.css'), 'utf8');
    const [light, systemDark, forcedDark] = [css.indexOf(':root,'), css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf("[data-theme='dark'] {")];
    const blocks = { light: css.slice(light, systemDark), systemDark: css.slice(systemDark, forcedDark), forcedDark: css.slice(forcedDark) };
    for (const c of Object.keys(CATEGORY_LABEL) as Category[]) {
      expect(blocks.light, c).toContain(`--cat-${c}:`);
      // Ben følger brandfarven, som selv skifter i mørk.
      if (c !== 'legs') for (const dark of [blocks.systemDark, blocks.forcedDark]) expect(dark, c).toContain(`--cat-${c}:`);
    }
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

describe('runder for ensidige øvelser', () => {
  const tahaev = resolveStrengthSession(plan, 'styrke-a', 6).slots.flatMap((s) => s.exercises).find((e) => e.exercise.id === 'enbens-tahaev')!;

  it('samler højre og venstre i én runde pr. sæt', () => {
    const rounds = toRounds(tahaev.rows);
    expect(tahaev.rows).toHaveLength(6);
    expect(rounds.map((r) => r.setNo)).toEqual([1, 2, 3]);
    expect(rounds[0].rows.map((r) => r.side)).toEqual(['H', 'V']);
  });

  it('viser forskellige mål pr. side', () => {
    expect(roundTarget(toRounds(tahaev.rows)[0], 'weight_reps')).toBe('12 H / 10 V reps');
    const same = toRounds([
      { setNo: 1, side: 'H', reps: { min: 8, max: 8 }, optional: false },
      { setNo: 1, side: 'V', reps: { min: 8, max: 8 }, optional: false },
    ]);
    expect(roundTarget(same[0], 'weight_reps')).toBe('8 reps');
  });

  it('opdager forskellige tal på siderne', () => {
    const log = (side: 'H' | 'V', weight_kg: number) => ({ set_no: 1, side, weight_kg, reps: 8, seconds: null });
    expect(sidesDiffer([log('H', 10), log('V', 10)])).toBe(false);
    expect(sidesDiffer([log('H', 10), log('V', 12)])).toBe(true);
    expect(sidesDiffer([log('H', 10)])).toBe(false);
  });
});

describe('øvelsesillustrationer', () => {
  const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  it('findes for alle planens øvelser og mobilitetspunkter', () => {
    const missing = [...plan.exercises.map((e) => [e.id, e.name]), ...(plan.mobility?.items ?? []).map((i) => [i.id, i.name])].filter(
      ([id, name]) => !illustrationFor(id, name),
    );
    expect(missing).toEqual([]);
  });

  it('genkender øvelser fra andre planer på navnet', () => {
    expect(illustrationFor('ukendt-id', 'Goblet split squat')).toBe(ILLUSTRATIONS['bulgarian-split-squat']);
    expect(illustrationFor('ukendt-id', 'Noget helt andet')).toBeUndefined();
  });

  it('bevarer lemmernes længde og det faste led gennem hele bevægelsen', () => {
    for (const ill of Object.values(ILLUSTRATIONS)) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const pose = blend(ill.from, ill.to, t);
        const s = solve(pose);
        expect(dist(s.hip, s.kneeN)).toBeCloseTo(LEN.thigh, 6);
        expect(dist(s.kneeN, s.ankleN)).toBeCloseTo(LEN.shin, 6);
        expect(dist(s.shoulder, s.elbowF)).toBeCloseTo(LEN.upperArm, 6);
        expect(s[pose.anchor][0]).toBeCloseTo(pose.at[0], 6);
        expect(s[pose.anchor][1]).toBeCloseTo(pose.at[1], 6);
      }
    }
  });

  it('bevæger sig blødt frem og tilbage med ophold i enderne', () => {
    expect(pingPong(0)).toBe(0);
    expect(pingPong(0.5)).toBeCloseTo(1, 6);
    expect(pingPong(1)).toBe(0);
    expect(pingPong(0.25)).toBeGreaterThan(0.4);
  });
});
