import { beforeEach, describe, expect, it } from 'vitest';
import planJson from '../plan/plan.v1.json';
import { PlanSchema, type Plan } from '../shared/plan.schema';
import { applySessionEdit, draftFor, newExerciseId, scopeFor, slugify, type DraftSlot } from '../shared/planEdit';
import { resolveStrengthSession } from '../shared/resolve';
import { getActivePlan, listPlanVersions } from '../worker/services/plan';
import { savePlanEdit } from '../worker/services/planEdits';
import { call, createWorld, type World } from './world';

const plan = PlanSchema.parse(planJson);

const ids = (p: Plan, week: number, session = 'styrke-a') => resolveStrengthSession(p, session, week).slots.map((s) => s.exercises.map((e) => e.exercise.id).join('+'));
const dose = (p: Plan, week: number, exerciseId: string, session = 'styrke-a') =>
  resolveStrengthSession(p, session, week)
    .slots.flatMap((s) => s.exercises)
    .find((e) => e.exercise.id === exerciseId)?.planned.dose;

/** Retter sessionen set i `week` med `edit` og lægger det ind for scopet. */
function edit(week: number, kind: Parameters<typeof scopeFor>[2], change: (d: DraftSlot[]) => DraftSlot[] | void, p: Plan = plan, session = 'styrke-a') {
  const drafts = draftFor(p, session, week);
  const out = change(drafts) ?? drafts;
  const result = applySessionEdit(p, session, week, scopeFor(p, week, kind), out);
  return PlanSchema.parse(result);
}

describe('rediger en session i planen', () => {
  it('rettet dosering kun i denne uge', () => {
    const before = dose(plan, 7, 'rdl')!;
    const p = edit(6, 'uge', (d) => {
      d[0].exercises[0].dose.sets = 5;
    });
    expect(dose(p, 6, 'rdl')!.sets).toBe(5);
    expect(dose(p, 7, 'rdl')).toEqual(before);
    expect(dose(p, 5, 'rdl')).toEqual(dose(plan, 5, 'rdl'));
  });

  it('fra denne uge og frem: kun hvor øvelsen og feltet var det samme', () => {
    const p = edit(6, 'frem', (d) => {
      d[0].exercises[0].dose.restSec = 150;
    });
    expect(dose(plan, 6, 'rdl')!.restSec).not.toBe(150);
    expect(dose(p, 6, 'rdl')!.restSec).toBe(150);
    expect(dose(p, 7, 'rdl')!.restSec).toBe(150);
    expect(dose(p, 5, 'rdl')).toEqual(dose(plan, 5, 'rdl'));
    // Uge 9–12 har en anden øvelse på pladsen og røres ikke.
    expect(dose(p, 9, 'enbens-rdl')).toEqual(dose(plan, 9, 'enbens-rdl'));
    // Uger med en anden pause i planen beholder deres.
    for (const week of [8, 13]) {
      const was = dose(plan, week, 'rdl')!.restSec;
      expect(dose(p, week, 'rdl')!.restSec).toBe(was === dose(plan, 6, 'rdl')!.restSec ? 150 : was);
    }
  });

  it('bytter en øvelse ud fra denne uge', () => {
    const p = edit(6, 'frem', (d) => {
      d[5].exercises[0] = { exerciseId: 'dead-bug', dose: { sets: 3, optionalSets: 0, reps: { min: 10, max: 10 }, restSec: 45 } };
    }, { ...plan, exercises: [...plan.exercises, { id: 'dead-bug', name: 'Dead bug', kind: 'bodyweight_reps', perSide: false }] });
    expect(ids(p, 5).at(-1)).toBe('hip-airplane');
    expect(ids(p, 6).at(-1)).toBe('dead-bug');
    expect(ids(p, 8).at(-1)).toBe('dead-bug');
    expect(ids(p, 9).at(-1)).toBe('pallof-press');
    expect(dose(p, 7, 'dead-bug')).toMatchObject({ sets: 3, reps: { min: 10, max: 10 } });
    // Sidefelterne fra en sidevis øvelse følger ikke med til en bilateral.
    expect(dose(p, 7, 'dead-bug')).not.toHaveProperty('sideOrder');
  });

  it('fjerner en øvelse kun i denne uge', () => {
    const p = edit(6, 'uge', (d) => d.filter((s) => s.slotId !== 'styrke-a-5'));
    expect(ids(p, 6)).not.toContain('copenhagen-plank');
    expect(ids(p, 7)).toContain('copenhagen-plank');
    expect(ids(p, 5)).toContain('copenhagen-plank');
  });

  it('tilføjer en ny øvelse i alle uger og placerer den hvor den står', () => {
    const p = edit(6, 'alle', (d) => {
      d.splice(1, 0, { slotId: null, exercises: [{ exerciseId: 'face-pull', dose: { sets: 2, optionalSets: 0, reps: { min: 15, max: 15 }, restSec: 45 } }] });
    });
    for (const week of [5, 6, 9, 13]) expect(ids(p, week)[1]).toBe('face-pull');
    expect(ids(p, 6)[0]).toBe('rdl');
    expect(ids(p, 6)).toHaveLength(7);
  });

  it('flytter rækkefølgen for alle uger', () => {
    const p = edit(6, 'uge', (d) => [d[1], d[0], ...d.slice(2)]);
    expect(ids(p, 6).slice(0, 2)).toEqual(['bulgarian-split-squat', 'rdl']);
    expect(ids(p, 9).slice(0, 2)).toEqual(['step-down', 'enbens-rdl']);
  });

  it('superset til enkeltøvelse kun hvor pladsen havde de samme øvelser', () => {
    const p = edit(6, 'frem', (d) => {
      const slot = d.find((s) => s.slotId === 'styrke-b-7')!;
      slot.exercises = slot.exercises.slice(0, 1);
    }, plan, 'styrke-b');
    expect(ids(p, 6, 'styrke-b')).toContain('biceps-curl');
    expect(ids(p, 6, 'styrke-b')).not.toContain('biceps-curl+triceps-pushdown');
    expect(ids(p, 5, 'styrke-b')).toContain('biceps-curl+triceps-pushdown');
    expect(ids(p, 9, 'styrke-b')).toContain('hammer-curl+overhead-triceps-extension');
  });

  it('ingen ændring giver samme plan', () => {
    expect(edit(6, 'frem', () => undefined)).toEqual(plan);
  });

  it('laver id til nye øvelser', () => {
    expect(slugify('Hip thrust på bænk (smal)')).toBe('hip-thrust-paa-baenk-smal');
    expect(slugify('Ølstræk')).toBe('oelstraek');
    expect(newExerciseId('RDL', ['rdl', 'rdl-2'])).toBe('rdl-3');
    expect(newExerciseId('!!!', [])).toBe('oevelse');
  });
});

describe('gem redigeret plan', () => {
  let w: World;
  let db: D1Database;
  const SIMON = 1;
  beforeEach(async () => {
    w = await createWorld();
    db = w.db;
  });

  const edited = (p: Plan) => {
    const d = draftFor(p, 'styrke-a', 6);
    d[0].exercises[0].dose.sets = 5;
    return applySessionEdit(p, 'styrke-a', 6, scopeFor(p, 6, 'uge'), d);
  };

  it('gemmer som ny aktiv version og gør Claudes ventende forslag forældede', async () => {
    const { plan: base } = await getActivePlan(db, SIMON);
    await db
      .prepare(
        "INSERT INTO plan_proposals (uuid, athlete_id, kind, created_at, base_version, summary, rationale, patch_json, status) VALUES ('00000000-0000-4000-8000-000000000001', ?, 'patch', '2026-10-07T10:00:00.000Z', 1, 'x', 'y', '[]', 'afventer')",
      )
      .bind(SIMON)
      .run();
    const saved = await savePlanEdit(db, SIMON, { baseVersion: 1, note: 'Flere sæt RDL', plan: edited(base) }, '2026-10-08T10:00:00.000Z');
    expect(saved.meta).toMatchObject({ version: 2, source: 'manual', note: 'Flere sæt RDL', based_on_version: 1, is_active: true });
    expect(saved.diff.join('\n')).toContain('Styrke A');
    expect((await listPlanVersions(db, SIMON)).map((v) => [v.version, v.is_active])).toEqual([
      [2, true],
      [1, false],
    ]);
    const status = await db.prepare('SELECT status FROM plan_proposals WHERE athlete_id = ?').bind(SIMON).first<string>('status');
    expect(status).toBe('forældet');
  });

  it('afviser en gammel udgave, ingen ændringer og et fjernet øvelses-id', async () => {
    const { plan: base } = await getActivePlan(db, SIMON);
    await expect(savePlanEdit(db, SIMON, { baseVersion: 3, plan: edited(base) })).rejects.toThrow('ændret i mellemtiden');
    await expect(savePlanEdit(db, SIMON, { baseVersion: 1, plan: base })).rejects.toThrow('Ingen ændringer');
    const without = { ...base, exercises: base.exercises.filter((e) => e.id !== 'skulderpres') };
    await expect(savePlanEdit(db, SIMON, { baseVersion: 1, plan: without })).rejects.toThrow('skulderpres');
  });

  it('kun atleten selv kan gemme via API’et', async () => {
    const { plan: base } = await getActivePlan(db, SIMON);
    const body = { baseVersion: 1, plan: edited(base) };
    expect((await call(w, w.karo, '/api/a/simon/plan/versions', { method: 'POST', json: body })).status).toBe(404);
    await db.prepare("INSERT INTO athlete_access (user_id, athlete_id, role, granted_at) VALUES (?, 1, 'traener', '2026-10-01T00:00:00.000Z')").bind(w.karo.userId).run();
    expect((await call(w, w.karo, '/api/a/simon/plan/versions', { method: 'POST', json: body })).status).toBe(403);
    const res = await call(w, w.simon, '/api/a/simon/plan/versions', { method: 'POST', json: body });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { meta: { version: number } }).meta.version).toBe(2);
  });
});
