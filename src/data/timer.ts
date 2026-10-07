// Pausetimer. Kun sluttidspunktet gemmes (localStorage), og resten regnes fra
// Date.now() — så timeren er korrekt efter slukket skærm og genstart af appen.
import { useEffect, useState, useSyncExternalStore } from 'react';

export interface TimerState {
  endsAt: number;
  durationSec: number;
  label: string;
  workoutUuid: string;
}

const KEY = 'traeningsnav.timer';
const listeners = new Set<() => void>();

function load(): TimerState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TimerState) : null;
  } catch {
    return null;
  }
}

let current = load();

function set(next: TimerState | null) {
  current = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // Privat tilstand: timeren lever kun i hukommelsen.
  }
  scheduleBeep();
  listeners.forEach((l) => l());
}

export function startTimer(durationSec: number, label: string, workoutUuid: string) {
  unlockAudio();
  set({ endsAt: Date.now() + durationSec * 1000, durationSec, label, workoutUuid });
}

/** Starter samme pause forfra. */
export function resetTimer() {
  if (current) startTimer(current.durationSec, current.label, current.workoutUuid);
}

export function skipTimer() {
  set(null);
}

// ─── Lyd ────────────────────────────────────────────────────────────────────
// iOS kræver at AudioContext startes i en brugerhandling. Tonen planlægges på
// lydurets tidslinje, så den spiller til tiden selv hvis JS er travlt.

let audio: AudioContext | undefined;
let scheduled: OscillatorNode[] = [];

function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = undefined;
  }
}

function scheduleBeep() {
  scheduled.forEach((o) => {
    try {
      o.stop();
    } catch {
      // Allerede stoppet.
    }
  });
  scheduled = [];
  if (!audio || !current) return;
  const delay = (current.endsAt - Date.now()) / 1000;
  if (delay < -1) return;
  const start = audio.currentTime + Math.max(0, delay);
  for (let i = 0; i < 3; i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    const t = start + i * 0.25;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.16);
    scheduled.push(osc);
  }
}

// Efter genstart findes ingen AudioContext. Første berøring låser lyden op igen.
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    () => {
      if (!audio && current) {
        unlockAudio();
        scheduleBeep();
      }
    },
    { capture: true },
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useTimer() {
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!state) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 250);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [state]);
  const remainingMs = state ? Math.max(0, state.endsAt - now) : 0;
  return { state, remainingMs, finished: !!state && remainingMs === 0 };
}
