// Den aktive plan for brugerens egen atlet. Vises straks fra den lokale cache og opdateres fra
// API'et, så appen starter uden net i fitness. En ny atlet har ingen plan, før hun godkender
// Claudes første forslag (`none`).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Profile } from '../../shared/athletes';
import type { Plan } from '../../shared/plan.schema';
import type { PlanVersionMeta } from '../../shared/records.schema';
import { athleteApi, OfflineError } from '../lib/api';
import { kvGet, kvSet } from './db';

export interface ActivePlan {
  meta: PlanVersionMeta;
  plan: Plan;
}

interface PlanState {
  /** Egen atlets slug. */
  slug: string;
  active?: ActivePlan;
  /** Serveren har svaret, at der ikke er nogen aktiv plan endnu. */
  none: boolean;
  /** Monitors, mobilitetstests og tærskelpuls for egen atlet. */
  profile?: Profile;
  loading: boolean;
  offline: boolean;
  error?: string;
  refresh: () => Promise<void>;
}

const PlanContext = createContext<PlanState | null>(null);
const PLAN_KEY = 'activePlan';
const PROFILE_KEY = 'profile';

export function PlanProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [active, setActive] = useState<ActivePlan>();
  const [none, setNone] = useState(false);
  const [profile, setProfile] = useState<Profile>();
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const [fresh, prof] = await Promise.all([athleteApi<ActivePlan | null>(slug, '/plan/active'), athleteApi<Profile>(slug, '/profile')]);
      setActive(fresh ?? undefined);
      setNone(!fresh);
      setProfile(prof);
      setOffline(false);
      setError(undefined);
      await kvSet(PLAN_KEY, fresh);
      await kvSet(PROFILE_KEY, prof);
    } catch (e) {
      if (e instanceof OfflineError) setOffline(true);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([kvGet<ActivePlan | null>(PLAN_KEY), kvGet<Profile>(PROFILE_KEY)]).then(([cached, prof]) => {
      if (cancelled) return;
      if (prof) setProfile((p) => p ?? prof);
      if (cached !== undefined) {
        setActive((a) => a ?? cached ?? undefined);
        setNone((n) => n || cached === null);
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

  return <PlanContext.Provider value={{ slug, active, none, profile, loading, offline, error, refresh }}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanState {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan uden PlanProvider');
  return ctx;
}

/** Aktive monitors (fx "Venstre lyske") for egen atlet, i visningsrækkefølge. */
export function useMonitors() {
  return (usePlan().profile?.monitors ?? []).filter((m) => m.active);
}

/** Aktive mobilitetstests for egen atlet. */
export function useMobilityTests() {
  return (usePlan().profile?.mobilityTests ?? []).filter((t) => t.active);
}
