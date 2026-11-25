// Data om en anden atlet (trænervisning) hentes direkte fra serveren og gemmes ikke lokalt:
// den lokale database indeholder kun brugerens egen træning.
import { useEffect, useState } from 'react';
import { athleteApi, OfflineError } from '../lib/api';

export interface Remote<T> {
  data?: T;
  error?: string;
  loading: boolean;
}

/**
 * Historikken for flere øvelser hos en anden atlet (trænervisningens fremgang): én GET pr. øvelse.
 * `ids` = null henter intet.
 */
export function useRemoteHistories<T>(slug: string, ids: string[] | null): Remote<Map<string, T[]>> {
  const [state, setState] = useState<Remote<Map<string, T[]>>>({ loading: true });
  const key = ids?.join(',') ?? null;
  useEffect(() => {
    if (key === null) return setState({ loading: false });
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const list = key ? key.split(',') : [];
    Promise.all(list.map((id) => athleteApi<T[]>(slug, `/history/exercises/${encodeURIComponent(id)}`).then((h) => [id, h] as const))).then(
      (pairs) => !cancelled && setState({ data: new Map(pairs), loading: false }),
      (e) => !cancelled && setState({ loading: false, error: e instanceof OfflineError ? 'Ingen forbindelse. Trænervisningen kræver net.' : (e as Error).message }),
    );
    return () => {
      cancelled = true;
    };
  }, [slug, key]);
  return state;
}

/** GET /api/a/<slug><path>. `path` = null henter intet. */
export function useRemote<T>(slug: string, path: string | null): Remote<T> {
  const [state, setState] = useState<Remote<T>>({ loading: true });
  useEffect(() => {
    if (path === null) return setState({ loading: false });
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    athleteApi<T>(slug, path).then(
      (data) => !cancelled && setState({ data, loading: false }),
      (e) => !cancelled && setState({ loading: false, error: e instanceof OfflineError ? 'Ingen forbindelse. Trænervisningen kræver net.' : (e as Error).message }),
    );
    return () => {
      cancelled = true;
    };
  }, [slug, path]);
  return state;
}
