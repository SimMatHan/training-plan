import { useEffect } from 'react';

/** Holder skærmen tændt mens `active` er sand (Screen Wake Lock, hvor understøttet). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        lock = await navigator.wakeLock.request('screen');
        if (cancelled) void lock.release();
      } catch {
        // Fx lavt batteri; ikke kritisk.
      }
    };
    void acquire();
    // Låsen frigives når appen skjules; hent den igen når den vises.
    const onVisible = () => void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, [active]);
}
