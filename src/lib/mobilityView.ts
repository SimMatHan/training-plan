// Hvordan mobilitetsblokken vises i en mobilitetssession: som tjekliste eller i afspilleren (stor figur,
// nedtælling og lyd, som en yogarutine). Afspilleren er standard; valget huskes på telefonen.
import { useCallback, useState } from 'react';

export type MobilityView = 'tjekliste' | 'afspiller';

const KEY = 'traeningsnav.mobilityView';

export function loadMobilityView(): MobilityView {
  try {
    return localStorage.getItem(KEY) === 'tjekliste' ? 'tjekliste' : 'afspiller';
  } catch {
    return 'afspiller';
  }
}

/** Åbner mobilitetssessionen i afspilleren næste gang (knappen "Start mobilitet" på I dag). */
export function preferPlayer() {
  try {
    localStorage.setItem(KEY, 'afspiller');
  } catch {
    // Privat tilstand: afspilleren er standard alligevel.
  }
}

export function useMobilityView(): [MobilityView, (v: MobilityView) => void] {
  const [view, setView] = useState<MobilityView>(loadMobilityView);
  const set = useCallback((v: MobilityView) => {
    setView(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // Privat tilstand: kun i denne visning.
    }
  }, []);
  return [view, set];
}

export const MOBILITY_VIEW_OPTIONS = [
  { value: 'tjekliste', label: 'Tjekliste' },
  { value: 'afspiller', label: 'Afspiller' },
] as const satisfies readonly { value: MobilityView; label: string }[];
