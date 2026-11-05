import { describe, expect, it } from 'vitest';
import planJson from '../plan/plan.v1.json';
import { PlanSchema } from '../shared/plan.schema';
import { getExercise, resolveStrengthSession, setRows } from '../shared/resolve';
import { keptRows, moveSlot, orderSlots, parseLayout, serializeLayout, withRemoved } from '../src/logic/layout';
import { slotSetProgress } from '../src/logic/progress';

const plan = PlanSchema.parse(planJson);
const ids = (slots: { slotId: string }[]) => slots.map((s) => s.slotId);
const slot = (slotId: string) => ({ slotId });

describe('træningens opsætning', () => {
  it('tolererer tom og ugyldig JSON og gemmer en tom opsætning som null', () => {
    expect(parseLayout(null)).toEqual({});
    expect(parseLayout('{ikke json')).toEqual({});
    expect(parseLayout('{"order":["a",2],"removed":{"rdl":[3,3,0,"x",2],"tom":[]}}')).toEqual({ order: ['a'], removed: { rdl: [2, 3] } });
    expect(serializeLayout({})).toBeNull();
    expect(serializeLayout({ order: [], removed: { rdl: [] } })).toBeNull();
    const layout = { order: ['b', 'a'], removed: { rdl: [3] } };
    expect(parseLayout(serializeLayout(layout))).toEqual(layout);
  });

  it('flytter en plads og lægger nye pladser ind efter den, de fulgte i planen', () => {
    const slots = ['a', 'b', 'c'].map(slot);
    expect(ids(orderSlots(slots, undefined))).toEqual(['a', 'b', 'c']);
    expect(moveSlot(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveSlot(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(ids(orderSlots(slots, ['c', 'a', 'b']))).toEqual(['c', 'a', 'b']);
    // En ekstra øvelse tilføjet efter flytningen kommer sidst; en udgået plads ignoreres.
    expect(ids(orderSlots([...slots, slot('ekstra:x')], ['c', 'gammel', 'a', 'b']))).toEqual(['c', 'a', 'b', 'ekstra:x']);
    // En ny plads midt i planen kommer foran den, den stod foran; ellers sidst.
    expect(ids(orderSlots(slots, ['c', 'a']))).toEqual(['b', 'c', 'a']);
    expect(ids(orderSlots(slots, ['b', 'a']))).toEqual(['b', 'a', 'c']);
  });

  it('fjerner og sætter planlagte sæt tilbage, og fremdriften tæller dem ikke', () => {
    const rdl = getExercise(plan, 'rdl')!;
    const rows = setRows(rdl, { sets: 3, optionalSets: 0, reps: { min: 8, max: 8 }, restSec: 90 });
    let layout = withRemoved({}, 'rdl', 3, true);
    expect(layout.removed).toEqual({ rdl: [3] });
    expect(keptRows(rows, layout.removed!.rdl).map((r) => r.setNo)).toEqual([1, 2]);
    layout = withRemoved(layout, 'rdl', 3, false);
    expect(serializeLayout(layout)).toBeNull();

    const session = plan.sessions.find((s) => s.kind === 'styrke')!;
    const first = resolveStrengthSession(plan, session.id, 1).slots[0];
    const ex = first.exercises[0];
    const all = slotSetProgress(plan, first, []).total;
    const last = ex.rows.at(-1)!.setNo;
    expect(slotSetProgress(plan, first, [], { [ex.exercise.id]: [last] }).total).toBe(all - 1);
  });
});
