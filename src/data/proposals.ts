// Claudes forslag til planen. Hentes fra API'et (de synkes ikke), og den seneste liste over
// ventende forslag gemmes lokalt, så banneret også vises uden net.
import { useCallback, useEffect, useState } from 'react';
import type { Proposal } from '../../shared/proposals';
import { api, OfflineError } from '../lib/api';
import { kvGet, kvSet } from './db';

const CACHE_KEY = 'pendingProposals';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Ventende forslag. Opdateres ved visning, når appen får fokus, og efter godkend/afvis. */
export function usePendingProposals(): Proposal[] {
  const [list, setList] = useState<Proposal[]>([]);
  const load = useCallback(async () => {
    try {
      const fresh = await api<Proposal[]>('/proposals?status=afventer');
      setList(fresh);
      await kvSet(CACHE_KEY, fresh);
    } catch (e) {
      if (!(e instanceof OfflineError)) console.warn('Forslag', e);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    void kvGet<Proposal[]>(CACHE_KEY).then((cached) => !cancelled && cached && setList(cached));
    void load();
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    listeners.add(load);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      listeners.delete(load);
    };
  }, [load]);
  return list;
}

export const fetchProposals = () => api<Proposal[]>('/proposals');
export const fetchProposal = (id: string) => api<Proposal>(`/proposals/${encodeURIComponent(id)}`);

export async function decideProposal(id: string, decision: 'approve' | 'reject'): Promise<Proposal> {
  const result = await api<Proposal>(`/proposals/${encodeURIComponent(id)}/${decision}`, { method: 'POST' });
  notify();
  return result;
}
