// Den aktive plan. Vises straks fra den lokale cache og opdateres fra API'et,
// så appen starter uden net i fitness.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Plan } from '../../shared/plan.schema';
import type { PlanVersionMeta } from '../../shared/records.schema';
import { api, OfflineError } from '../lib/api';
import { kvGet, kvSet } from './db';

export interface ActivePlan {
  meta: PlanVersionMeta;
  plan: Plan;
}

interface PlanState {
  active?: ActivePlan;
  loading: boolean;
  offline: boolean;
  error?: string;
  refresh: () => Promise<void>;
}

const PlanContext = createContext<PlanState | null>(null);
const CACHE_KEY = 'activePlan';

export function PlanProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActivePlan>();
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const fresh = await api<ActivePlan>('/plan/active');
      setActive(fresh);
      setOffline(false);
      setError(undefined);
      await kvSet(CACHE_KEY, fresh);
    } catch (e) {
      if (e instanceof OfflineError) setOffline(true);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    kvGet<ActivePlan>(CACHE_KEY).then((cached) => {
      if (!cancelled && cached) {
        setActive((a) => a ?? cached);
        setLoading(false);
      }
    });
    void refresh();
    const onOnline = () => void refresh();
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
    };
  }, [refresh]);

  return <PlanContext.Provider value={{ active, loading, offline, error, refresh }}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanState {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan uden PlanProvider');
  return ctx;
}
