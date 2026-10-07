import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Panel nedefra (bottom sheet) bygget på <dialog>: fokus fanges i panelet,
 * Escape og tryk på baggrunden lukker, og fokus vender tilbage bagefter.
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
      className="pb-safe fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl bg-bg p-0 text-fg backdrop:bg-black/45"
    >
      {open && (
        <div className="mx-auto max-w-xl px-4 pt-3 pb-5">
          <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-2xl">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="min-h-12 rounded-lg px-3 font-medium text-muted">
              Luk
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
