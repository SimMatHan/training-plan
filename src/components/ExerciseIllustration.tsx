import { useState, type ReactNode } from 'react';
import { illustrationFor } from '../logic/illustrations';
import { Figure } from '../ui/Figure';
import { Sheet } from '../ui/Sheet';

/**
 * Lille illustration af en øvelse (stillestående: slutstillingen med starten svagt bagved).
 * Tryk åbner et ark, hvor figuren laver bevægelsen, med dosering og udførelse under.
 * Viser intet, hvis øvelsen ikke har en illustration.
 */
export function ExerciseIllustration({
  id,
  name,
  details,
  size = 'md',
}: {
  id: string;
  name: string;
  /** Dosering, tempo og udførelse til arket. */
  details?: ReactNode;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const illustration = illustrationFor(id, name);
  if (!illustration) return null;

  return (
    <>
      {/* Lille: i hvide lister (grå bund). Mellem: på den grå side (hvid bund). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Se hvordan ${name} udføres`}
        className={`shrink-0 rounded-[12px] p-1 transition-transform duration-150 ease-ios active:scale-[.97] ${size === 'sm' ? 'w-14 bg-bg' : 'w-28 bg-surface'}`}
      >
        <Figure illustration={illustration} label="" className="block h-auto w-full" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={name}>
        <div className="mb-4 rounded-card bg-bg p-2">
          {open && <Figure illustration={illustration} animate label={`${name}: bevægelsen vist som tændstiksmand`} className="block h-auto w-full" />}
        </div>
        {details}
      </Sheet>
    </>
  );
}
