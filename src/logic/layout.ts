// Træningens egen opsætning, ud over planen: øvelsernes rækkefølge og planlagte sæt der er fjernet.
// Gemmes som JSON i workouts.layout, så det synker med træningen. Planen ændres ikke.
import type { SetRow } from '../../shared/resolve';

export interface Layout {
  /** Pladsernes id'er (slotId) i den rækkefølge, de tages i dag. */
  order?: string[];
  /** Planlagte sætnumre fjernet pr. øvelse (begge sider af sættet). */
  removed?: Record<string, number[]>;
}

/** Tolerant: ugyldig eller tom JSON giver en tom opsætning. */
export function parseLayout(json: string | null | undefined): Layout {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const { order, removed } = raw as Record<string, unknown>;
    const layout: Layout = {};
    if (Array.isArray(order)) layout.order = order.filter((x): x is string => typeof x === 'string');
    if (removed && typeof removed === 'object') {
      const r: Record<string, number[]> = {};
      for (const [id, nos] of Object.entries(removed)) {
        const list = Array.isArray(nos) ? nos.filter((n): n is number => Number.isInteger(n) && n > 0) : [];
        if (list.length) r[id] = [...new Set(list)].sort((a, b) => a - b);
      }
      if (Object.keys(r).length) layout.removed = r;
    }
    return layout;
  } catch {
    return {};
  }
}

/** Til workouts.layout. En tom opsætning gemmes som null. */
export function serializeLayout(layout: Layout): string | null {
  const out: Layout = {};
  if (layout.order?.length) out.order = layout.order;
  const removed = Object.fromEntries(Object.entries(layout.removed ?? {}).filter(([, nos]) => nos.length));
  if (Object.keys(removed).length) out.removed = removed;
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/**
 * Pladserne i dagens rækkefølge. En plads der ikke står i den gemte rækkefølge (en øvelse tilføjet
 * bagefter, eller en ændret plan), kommer foran den plads, den stod foran i planen, ellers sidst.
 */
export function orderSlots<T extends { slotId: string }>(slots: T[], order: string[] | undefined): T[] {
  if (!order?.length) return slots;
  const byId = new Map(slots.map((s) => [s.slotId, s]));
  const saved = [...new Set(order)].filter((id) => byId.has(id)).map((id) => byId.get(id)!);
  const result = [...saved];
  slots.forEach((slot, i) => {
    if (saved.includes(slot)) return;
    const after = slots.slice(i + 1).find((s) => saved.includes(s));
    result.splice(after ? result.indexOf(after) : result.length, 0, slot);
  });
  return result;
}

/** Rækkefølgen med `slotId` flyttet én plads op (-1) eller ned (+1). */
export function moveSlot(ids: string[], slotId: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(slotId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Planens sætrækker uden de fjernede sæt. */
export const keptRows = (rows: SetRow[], removed: number[] | undefined): SetRow[] => (removed?.length ? rows.filter((r) => !removed.includes(r.setNo)) : rows);

/** Opsætningen med et planlagt sæt fjernet (true) eller sat tilbage (false). */
export function withRemoved(layout: Layout, exerciseId: string, setNo: number, remove: boolean): Layout {
  const current = layout.removed?.[exerciseId] ?? [];
  const nos = remove ? [...new Set([...current, setNo])].sort((a, b) => a - b) : current.filter((n) => n !== setNo);
  return { ...layout, removed: { ...layout.removed, [exerciseId]: nos } };
}
