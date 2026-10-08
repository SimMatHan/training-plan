// Login-tilstand i appen. Sessionen er en HttpOnly-cookie, som appen ikke kan se; her huskes kun
// hvem der er logget ind (til offline-start) og om serveren har afvist sessionen.
//
// Udløber sessionen, mens der er data i udbakken, bevares den lokale database: logningen sendes
// efter næste login. Kun "Log ud" sletter den lokale database.
import { useSyncExternalStore } from 'react';
import type { AthleteRef, Me } from '../../shared/athletes';

const KEY = 'traeningsnav.me';
const listeners = new Set<() => void>();

export type AuthState = { status: 'loading' } | { status: 'out'; me: Me | null } | { status: 'in'; me: Me };

function readCached(): Me | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

let state: AuthState = { status: 'loading' };
const set = (next: AuthState) => {
  state = next;
  listeners.forEach((l) => l());
};

export function setMe(me: Me) {
  try {
    localStorage.setItem(KEY, JSON.stringify(me));
  } catch {
    // Privat tilstand: kun i hukommelsen.
  }
  set({ status: 'in', me });
}

/** Serveren afviste sessionen (401). Den lokale database og udbakken bevares. */
export function markLoggedOut() {
  if (state.status !== 'out') set({ status: 'out', me: state.status === 'in' ? state.me : readCached() });
}

/** Henter /api/me. Uden net bruges den sidst kendte bruger, så appen virker offline. */
export async function loadMe(): Promise<void> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.status === 401) return set({ status: 'out', me: readCached() });
    if (!res.ok) throw new Error(res.statusText);
    setMe((await res.json()) as Me);
  } catch {
    const cached = readCached();
    set(cached ? { status: 'in', me: cached } : { status: 'out', me: null });
  }
}

/** Glemmer brugeren på enheden (ved "Log ud"). */
export function forgetMe() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ikke kritisk.
  }
  set({ status: 'out', me: null });
}

export const getAuth = () => state;

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Den indloggede bruger. Kun til brug inde i appen (efter login). */
export function useMe(): Me {
  const s = useAuth();
  if (s.status !== 'in') throw new Error('useMe uden login');
  return s.me;
}

/** Brugerens egen atlet (rollen ejer). */
export const ownAthlete = (me: Me): AthleteRef | undefined => me.athletes.find((a) => a.role === 'ejer');

/**
 * Slug for brugerens egen atlet: al lokal logning og sync går hertil. Også mens sessionen er
 * udløbet (status 'out' med kendt bruger), så intet logget går tabt; det sendes efter login.
 */
export function ownSlug(): string | null {
  const me = state.status === 'loading' ? null : state.me;
  return me ? (ownAthlete(me)?.slug ?? null) : null;
}
