import { useAppUpdate } from '../lib/appUpdate';
import { SmallButton } from '../ui/Button';

/** Diskret svævende bjælke når en ny version er klar. Ligger over fanebjælken. */
export function UpdateBanner() {
  const { ready, apply, dismiss, dismissed } = useAppUpdate();
  if (!ready || dismissed) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.75rem)] z-20 px-3 pb-2">
      <div className="animate-sheet mx-auto flex max-w-xl items-center gap-2 rounded-card bg-surface py-1.5 pr-1.5 pl-4 shadow-float">
        <span className="min-w-0 flex-1 text-secondary font-semibold">Ny version klar</span>
        <SmallButton onClick={dismiss} className="bg-transparent text-ink-2">
          Senere
        </SmallButton>
        <SmallButton variant="primary" onClick={apply}>
          Opdater
        </SmallButton>
      </div>
    </div>
  );
}
