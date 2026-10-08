import { Check } from '@phosphor-icons/react';
import { useState } from 'react';
import type { Plan } from '../../shared/plan.schema';
import type { MobilityCheck } from '../../shared/records.schema';
import { setMobilityCheck } from '../data/workouts';
import { IconTile } from '../ui/IconTile';
import { InsetList } from '../ui/InsetList';
import { TILE_INSET } from '../ui/ExerciseRow';

/** Mobilitetsblokken som tjekliste. Gemmes pr. punkt. */
export function MobilityChecklist({ plan, workoutUuid, checks }: { plan: Plan; workoutUuid: string; checks: MobilityCheck[] }) {
  const block = plan.mobility;
  // Optimistisk: vis trykket med det samme, også før IndexedDB har svaret.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const saved = new Set(checks.filter((c) => c.done).map((c) => c.item_id));
  const isDone = (id: string) => pending[id] ?? saved.has(id);
  if (!block) return null;

  return (
    <InsetList inset={TILE_INSET} label={block.name}>
      {block.items.map((item) => {
        const checked = isDone(item.id);
        return (
          <li key={item.id}>
            <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5">
              <IconTile category="mobility" />
              <span className="min-w-0 flex-1">
                <span className={`block text-row ${checked ? 'text-ink-2' : ''}`}>{item.name}</span>
                <span className="num block text-secondary text-ink-2">{item.dose}</span>
              </span>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  const done = e.target.checked;
                  setPending((p) => ({ ...p, [item.id]: done }));
                  void setMobilityCheck(workoutUuid, item.id, done);
                }}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={`grid size-8 shrink-0 place-items-center rounded-full peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-red ${
                  checked ? 'animate-pop bg-status-green text-on-brand' : 'text-transparent ring-2 ring-separator ring-inset'
                }`}
              >
                <Check size={18} weight="bold" />
              </span>
            </label>
          </li>
        );
      })}
    </InsetList>
  );
}
