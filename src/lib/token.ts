// API-tokenet gemmes lokalt på enheden. Appen beder om det én gang.
import { useSyncExternalStore } from 'react';

const KEY = 'traeningsnav.token';
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let current = read();

export const getToken = () => current;

export function setToken(token: string | null) {
  current = token;
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // Privat tilstand: tokenet lever kun i hukommelsen.
  }
  listeners.forEach((l) => l());
}

export function useToken() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getToken,
  );
}
