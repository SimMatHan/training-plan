import { useSyncExternalStore } from 'react';
import type { AthleteRef } from '../../shared/athletes';
import { ownAthlete, useMe } from '../lib/auth';
import { Segmented } from '../ui/Segmented';

const KEY = 'traeningsnav.viewAthlete';
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let current = read();

function choose(slug: string) {
  current = slug;
  try {
    localStorage.setItem(KEY, slug);
  } catch {
    // Ikke kritisk.
  }
  listeners.forEach((l) => l());
}

/**
 * Atleten der vises i Uge og Historik. ?atlet=<slug> i adressen vinder; ellers det sidst valgte,
 * ellers brugerens egen. I dag viser altid kun egen atlet.
 */
export function useViewedAthlete(fromUrl?: string | null): AthleteRef & { own: boolean } {
  const me = useMe();
  const stored = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const own = ownAthlete(me) ?? me.athletes[0];
  const picked = me.athletes.find((a) => a.slug === (fromUrl ?? stored)) ?? own;
  return { ...picked, own: picked.slug === own?.slug };
}

/** Vælger øverst i Uge og Historik, når brugeren har adgang til flere atleter. */
export function AthletePicker({ value, onChange }: { value: string; onChange?: (slug: string) => void }) {
  const me = useMe();
  if (me.athletes.length < 2) return null;
  return (
    <Segmented
      className="mb-4"
      label="Atlet"
      value={value}
      onChange={(slug) => {
        choose(slug);
        onChange?.(slug);
      }}
      options={me.athletes.map((a) => ({ value: a.slug, label: a.role === 'ejer' ? `${a.name} (dig)` : a.name }))}
    />
  );
}
