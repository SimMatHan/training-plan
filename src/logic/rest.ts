import type { Dose } from '../../shared/plan.schema';
import type { SetRow } from '../../shared/resolve';

/**
 * Pause i sekunder efter et færdigt sæt, eller 0 hvis næste sæt tages med det samme:
 * - første øvelse i et superset → videre til anden øvelse
 * - unilateral skiftevis → første side af parret går direkte videre til anden side
 */
export function restAfter(rows: SetRow[], index: number, dose: Dose, opts: { supersetFirst: boolean }): number {
  if (opts.supersetFirst) return 0;
  const row = rows[index];
  const next = rows[index + 1];
  if (row.side && (dose.sidePattern ?? 'alternate') === 'alternate' && next && next.setNo === row.setNo && next.side !== row.side) return 0;
  return dose.restSec;
}
