// Opdatering af appen efter et nyt deploy. Service workeren henter den nye
// version i baggrunden, men skifter først når brugeren trykker "Opdater"
// (registerType: 'prompt'). Data ligger i IndexedDB og timeren i localStorage,
// så intet går tabt ved genindlæsningen.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const CHECK_EVERY_MS = 30 * 60 * 1000;

interface AppUpdate {
  /** En ny version er hentet og klar. */
  ready: boolean;
  /** Skift til den nye version (genindlæser appen). */
  apply: () => void;
  /** Søg efter en ny version nu. */
  check: () => Promise<'found' | 'none' | 'offline'>;
  /** Skjul banneret indtil næste gang appen åbnes. */
  dismiss: () => void;
  dismissed: boolean;
}

const Ctx = createContext<AppUpdate | null>(null);

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const [dismissed, setDismissed] = useState(false);

  const {
    needRefresh: [ready],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    // Genindlæsningen styres af apply(); pluginnet genindlæser kun, hvis siden
    // allerede var styret af en service worker, da den blev åbnet.
    onNeedReload() {},
    onRegisteredSW(_url, r) {
      registration.current = r;
      if (!r) return;
      // iOS tjekker sjældent selv; tjek når appen åbnes/får fokus og jævnligt.
      const update = () => navigator.onLine && void r.update().catch(() => {});
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && update());
      setInterval(update, CHECK_EVERY_MS);
    },
  });

  const check = useCallback(async () => {
    const r = registration.current;
    if (!r) return 'none' as const;
    if (!navigator.onLine) return 'offline' as const;
    try {
      await r.update();
    } catch {
      return 'offline' as const;
    }
    setDismissed(false);
    return r.installing || r.waiting ? ('found' as const) : ('none' as const);
  }, []);

  const apply = useCallback(() => {
    // Genindlæs når den nye service worker har overtaget siden.
    navigator.serviceWorker?.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    void updateServiceWorker(true);
  }, [updateServiceWorker]);

  const value: AppUpdate = {
    ready,
    apply,
    check,
    dismiss: () => setDismissed(true),
    dismissed,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppUpdate(): AppUpdate {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppUpdate uden AppUpdateProvider');
  return ctx;
}

/** Version og byggetidspunkt, sat af Vite ved build. */
export const BUILD = { id: __BUILD_ID__, time: __BUILD_TIME__ };
