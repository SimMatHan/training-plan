// Claudes forslag. Hentes fra API'et (de synkes ikke), og den seneste liste over egne ventende
// forslag gemmes lokalt, så banneret også vises uden net.
import { useCallback, useEffect, useState } from 'react';
import type { Proposal } from '../../shared/proposals';
import { athleteApi, OfflineError } from '../lib/api';
import { kvGet, kvSet } from './db';
import { usePlan } from './plan';

const CACHE_KEY = 'pendingProposals';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Egne ventende forslag. Opdateres ved visning, når appen får fokus, og efter godkend/afvis. */
export function usePendingProposals(): Proposal[] {
  const { slug } = usePlan();
  const [list, setList] = useState<Proposal[]>([]);
  const load = useCallback(async () => {
    try {
      const fresh = await athleteApi<Proposal[]>(slug, '/proposals?status=afventer');
      setList(fresh);
      await kvSet(CACHE_KEY, fresh);
    } catch (e) {
      if (!(e instanceof OfflineError)) console.warn('Forslag', e);
    }
  }, [slug]);
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

export const fetchProposals = (slug: string) => athleteApi<Proposal[]>(slug, '/proposals');
export const fetchProposal = (slug: string, id: string) => athleteApi<Proposal>(slug, `/proposals/${encodeURIComponent(id)}`);

/** Godkend eller afvis. Kun atleten selv (serveren afviser en træner med 403). */
export async function decideProposal(slug: string, id: string, decision: 'approve' | 'reject'): Promise<Proposal> {
  const result = await athleteApi<Proposal>(slug, `/proposals/${encodeURIComponent(id)}/${decision}`, { method: 'POST' });
  notify();
  return result;
}
