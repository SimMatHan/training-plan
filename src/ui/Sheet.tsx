import { useEffect, useId, useRef, type ReactNode } from 'react';
import { TextButton } from './Button';

/**
 * Bundark med håndtag, radius 16 i toppen, glider op (240 ms ease-out). Bygget på <dialog>:
 * fokus fanges i arket, Escape og tryk på baggrunden lukker, og fokus vender tilbage bagefter.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="pb-safe animate-sheet fixed inset-x-0 top-auto bottom-0 m-0 max-h-[88dvh] w-full max-w-none overflow-y-auto rounded-t-card bg-surface p-0 text-ink shadow-float backdrop:bg-scrim"
    >
      {open && (
        <div className="mx-auto max-w-xl px-4 pt-2 pb-6">
          <div aria-hidden="true" className="mx-auto mb-2 h-[5px] w-9 rounded-full bg-ink-3/60" />
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-title">
              {title}
            </h2>
            <TextButton onClick={onClose}>Luk</TextButton>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
