import { CaretDown, Check } from '@phosphor-icons/react';
import { useState } from 'react';
import type { Plan } from '../../shared/plan.schema';
import type { MobilityCheck } from '../../shared/records.schema';
import { isComplete, type Progress } from '../logic/progress';
import { IconTile } from '../ui/IconTile';
import { InsetList } from '../ui/InsetList';
import { ExerciseIllustration } from './ExerciseIllustration';

/**
 * Mobilitetsblokken som et kort, der kan foldes sammen, med tjeklisten indeni. Åben, indtil den er lavet
 * (eller som `defaultOpen` siger). Bruges i logningen og til morgen- og aftenrunden på I dag.
 */
export function MobilityBlockCard({
  plan,
  title,
  kicker,
  checks,
  onToggle,
  progress,
  defaultOpen,
}: {
  plan: Plan;
  title: string;
  /** Kort tekst før antal øvelser, fx "Morgenrunden". */
  kicker?: string;
  checks: Pick<MobilityCheck, 'item_id' | 'done'>[];
  onToggle: (itemId: string, done: boolean) => void;
  progress: Progress;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => defaultOpen ?? !isComplete(progress));
  const block = plan.mobility!;
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 rounded-card bg-surface p-3 text-left">
        <IconTile category="mobility" size={44} />
        <span className="min-w-0 flex-1">
          <span className="block text-headline text-brand-red">{title}</span>
          <span className="num block text-footnote text-ink-2">
            {kicker && `${kicker} · `}
            {block.items.length} øvelser{block.durationMin && ` · ${block.durationMin.min}–${block.durationMin.max} min`}
          </span>
        </span>
        <span className="num text-secondary text-ink-2">
          {progress.done}/{progress.total}
        </span>
        <CaretDown size={18} weight="bold" className={`text-ink-3 transition-transform duration-200 ease-ios ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="mt-2">
          <MobilityChecklist plan={plan} checks={checks} onToggle={onToggle} />
        </div>
      )}
    </>
  );
}

/**
 * Mobilitetsblokken som tjekliste. Gemmes pr. punkt via `onToggle`: i en træning (mobility_checks)
 * eller i en runde på en dato (mobility_round_checks).
 */
export function MobilityChecklist({
  plan,
  checks,
  onToggle,
}: {
  plan: Plan;
  checks: Pick<MobilityCheck, 'item_id' | 'done'>[];
  onToggle: (itemId: string, done: boolean) => void;
}) {
  const block = plan.mobility;
  // Optimistisk: vis trykket med det samme, også før IndexedDB har svaret.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const saved = new Set(checks.filter((c) => c.done).map((c) => c.item_id));
  const isDone = (id: string) => pending[id] ?? saved.has(id);
  if (!block) return null;

  return (
    <InsetList inset={84} label={block.name}>
      {block.items.map((item) => {
        const checked = isDone(item.id);
        return (
          <li key={item.id} className="flex items-center gap-3 pl-4">
            <ExerciseIllustration
              id={item.id}
              name={item.name}
              size="sm"
              details={
                <div className="flex flex-col gap-1 px-1">
                  <p className="num text-body">{item.dose}</p>
                  {item.cue && <p className="text-secondary text-ink-2">{item.cue}</p>}
                </div>
              }
            />
            <label className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2.5 pr-4">
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
                  onToggle(item.id, done);
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
