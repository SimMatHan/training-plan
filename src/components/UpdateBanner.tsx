import { useAppUpdate } from '../lib/appUpdate';

/** Diskret bjælke når en ny version er klar. Ligger over bundnavigationen. */
export function UpdateBanner() {
  const { ready, apply, dismiss, dismissed } = useAppUpdate();
  if (!ready || dismissed) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.75rem)] z-20 px-3 pb-2">
      <div className="mx-auto flex max-w-xl items-center gap-2 rounded-xl bg-fg py-1.5 pr-1.5 pl-4 text-bg shadow-lg">
        <span className="min-w-0 flex-1 text-sm font-medium">Ny version klar</span>
        <button type="button" onClick={dismiss} className="min-h-11 rounded-lg px-3 text-sm opacity-80">
          Senere
        </button>
        <button type="button" onClick={apply} className="min-h-11 rounded-lg bg-bg px-4 text-sm font-semibold text-fg">
          Opdater
        </button>
      </div>
    </div>
  );
}
