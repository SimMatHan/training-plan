import { useId, type ReactNode } from 'react';
import type { Progress } from '../logic/progress';
import { isComplete } from '../logic/progress';

/**
 * Sammenfoldelig sektion i en session. Overskriften viser altid navn,
 * dosering og fremskridt, så en sammenfoldet øvelse kan læses på to sekunder.
 */
export function Collapsible({
  id,
  title,
  subtitle,
  progress,
  open,
  onToggle,
  accent,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  progress: Progress;
  open: boolean;
  onToggle: () => void;
  /** Lille farvestreg til venstre (mobilitet). */
  accent?: string;
  children: ReactNode;
}) {
  const panelId = useId();
  const complete = isComplete(progress);

  return (
    <section id={`sektion-${id}`} className="scroll-mt-4">
      <h2 className="text-xl">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex min-h-16 w-full items-center gap-3 py-3 text-left"
        >
          {accent && <span aria-hidden="true" className={`h-8 w-1.5 shrink-0 rounded-full ${accent}`} />}
          <span className="min-w-0 flex-1">
            <span className={`block truncate ${complete && !open ? 'text-muted' : ''}`}>{title}</span>
            {subtitle && <span className="num block truncate text-sm font-normal text-muted [font-stretch:100%]">{subtitle}</span>}
          </span>
          <span className={`num flex shrink-0 items-center gap-1.5 text-base ${complete ? 'font-semibold text-mob-ink' : 'text-muted'}`}>
            {complete ? (
              <>
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7" />
                </svg>
                <span className="sr-only">Færdig, </span>
                {progress.done}/{progress.total}
              </>
            ) : (
              <>
                {progress.done}/{progress.total}
                <span className="sr-only"> færdige</span>
              </>
            )}
          </span>
          <svg viewBox="0 0 24 24" className={`size-5 shrink-0 text-muted ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </h2>
      <div id={panelId} hidden={!open}>
        {open && children}
      </div>
    </section>
  );
}
