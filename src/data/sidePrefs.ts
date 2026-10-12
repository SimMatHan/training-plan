// Hvilke ensidige øvelser der logges med forskellige tal pr. side. En præference på telefonen
// (localStorage), ikke data: standard er én række pr. runde for begge sider.
import { useState } from 'react';

const KEY = 'traeningsnav.perSide';

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** [slået til, sæt] for én øvelse. */
export function usePerSidePref(exerciseId: string): [boolean, (on: boolean) => void] {
  // Læses ved hver visning, så den følger øvelsen (fx når alternativet vælges).
  const [, rerender] = useState(0);
  const on = read().includes(exerciseId);
  const set = (next: boolean) => {
    try {
      const ids = new Set(read());
      if (next) ids.add(exerciseId);
      else ids.delete(exerciseId);
      localStorage.setItem(KEY, JSON.stringify([...ids]));
    } catch {
      // Privat tilstand: valget huskes ikke.
    }
    rerender((n) => n + 1);
  };
  return [on, set];
}
