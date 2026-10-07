import { useState } from 'react';
import type { Plan } from '../../shared/plan.schema';
import type { MobilityCheck } from '../../shared/records.schema';
import { setMobilityCheck } from '../data/workouts';

/** Mobilitetsblokken som tjekliste. Gemmes pr. punkt. */
export function MobilityChecklist({
  plan,
  workoutUuid,
  checks,
  hideHeading = false,
}: {
  plan: Plan;
  workoutUuid: string;
  checks: MobilityCheck[];
  /** Skjul overskriften, når sektionens overskrift allerede viser den. */
  hideHeading?: boolean;
}) {
  const block = plan.mobility;
  // Optimistisk: vis trykket med det samme, også før IndexedDB har svaret.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const saved = new Set(checks.filter((c) => c.done).map((c) => c.item_id));
  const isDone = (id: string) => pending[id] ?? saved.has(id);
  const count = block.items.filter((i) => isDone(i.id)).length;

  return (
    <section aria-labelledby={hideHeading ? undefined : 'mobility-heading'} aria-label={hideHeading ? block.name : undefined} className={hideHeading ? 'pb-5' : 'py-5'}>
      <div className={`mb-2 flex items-baseline justify-between gap-3 ${hideHeading ? 'hidden' : ''}`}>
        <h2 id="mobility-heading" className="flex items-center gap-2 text-2xl">
          <span aria-hidden="true" className="inline-block h-6 w-1.5 rounded-full bg-mob" />
          {block.name}
        </h2>
        <span className="num text-sm text-muted">
          {count}/{block.items.length}
        </span>
      </div>
      <ul className="divide-y divide-line border-y border-line">
        {block.items.map((item) => {
          const checked = isDone(item.id);
          return (
            <li key={item.id}>
              <label className="flex min-h-14 cursor-pointer items-center gap-3 py-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const done = e.target.checked;
                    setPending((p) => ({ ...p, [item.id]: done }));
                    void setMobilityCheck(workoutUuid, item.id, done);
                  }}
                  className="size-7 shrink-0 accent-[var(--mob)]"
                />
                <span className="min-w-0 flex-1">
                  <span className={`block font-medium ${checked ? 'text-muted line-through decoration-1' : ''}`}>{item.name}</span>
                  <span className="num block text-sm text-muted">{item.dose}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
