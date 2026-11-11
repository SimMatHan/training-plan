// Lyde til yogarutinen, syntetiseret med Web Audio (ingen lydfiler): klokke ved næste stilling, dobbelttone ved
// skift af side, tik i nedtællingen, en lys tone når holdet starter, en blød tone halvvejs og en gong til sidst.
// Lydene planlægges på lydurets tidslinje et stykke frem, så de kommer præcist, også når JS er travlt.
// Oplæsning (stillingens navn, "Skift side") bruger telefonens/TV'ets danske stemme, hvis den findes.
import type { YogaCue, YogaSound } from '../../shared/yoga';

let ctx: AudioContext | undefined;

/** Skal kaldes fra en brugerhandling (iOS og TV-browsere). */
export function unlockYogaAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = undefined;
  }
  // iOS låser også oplæsningen op på første tryk.
  try {
    if ('speechSynthesis' in window && !spokeOnce) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
      spokeOnce = true;
    }
  } catch {
    // Ingen stemme.
  }
}

let spokeOnce = false;

export const audioReady = () => !!ctx && ctx.state === 'running';

// ─── Syntese ────────────────────────────────────────────────────────────────

/** En tone med partialer og eksponentielt henfald. Giver noderne, så de kan stoppes. */
function bell(c: AudioContext, t: number, freq: number, opts: { decay: number; gain: number; partials?: [number, number][]; type?: OscillatorType }) {
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(opts.gain, t + 0.008);
  out.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
  out.connect(c.destination);
  const nodes: OscillatorNode[] = [];
  for (const [ratio, level] of opts.partials ?? [[1, 1]]) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.value = freq * ratio;
    g.gain.value = level;
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + opts.decay + 0.05);
    nodes.push(o);
  }
  return nodes;
}

// Klokke-agtige partialer (lidt uharmoniske), som en syngeskål.
const BOWL: [number, number][] = [
  [1, 1],
  [2.01, 0.45],
  [2.76, 0.25],
  [5.4, 0.08],
];
const CHIME: [number, number][] = [
  [1, 1],
  [3, 0.18],
];

/** Afspiller en lyd på lydurets tid `t`. */
function play(c: AudioContext, sound: YogaSound, t: number): OscillatorNode[] {
  switch (sound) {
    case 'tick':
      return bell(c, t, 1180, { decay: 0.09, gain: 0.22, partials: [[1, 1]], type: 'triangle' });
    case 'start':
      return [...bell(c, t, 880, { decay: 0.7, gain: 0.32, partials: CHIME }), ...bell(c, t + 0.09, 1318.5, { decay: 0.9, gain: 0.26, partials: CHIME })];
    case 'skift':
      // Ding-dong: tydeligt anderledes end de andre, så man hører skiftet uden at kigge.
      return [...bell(c, t, 784, { decay: 0.55, gain: 0.34, partials: CHIME }), ...bell(c, t + 0.32, 587.3, { decay: 0.8, gain: 0.34, partials: CHIME })];
    case 'naeste':
      return bell(c, t, 528, { decay: 2.2, gain: 0.3, partials: BOWL });
    case 'klar':
      return bell(c, t, 440, { decay: 2.4, gain: 0.3, partials: BOWL });
    case 'halvvejs':
      return bell(c, t, 660, { decay: 0.6, gain: 0.12, partials: CHIME });
    case 'faerdig':
      return [
        ...bell(c, t, 523.3, { decay: 1.2, gain: 0.25, partials: CHIME }),
        ...bell(c, t + 0.22, 659.3, { decay: 1.2, gain: 0.25, partials: CHIME }),
        ...bell(c, t + 0.44, 784, { decay: 1.4, gain: 0.25, partials: CHIME }),
        ...bell(c, t + 0.8, 196, { decay: 4.5, gain: 0.4, partials: BOWL }),
      ];
  }
}

/** Én lyd med det samme (fx forhåndslyt i indstillingerne). */
export function previewSound(sound: YogaSound) {
  unlockYogaAudio();
  if (ctx) play(ctx, sound, ctx.currentTime + 0.02);
}

// ─── Stemme ─────────────────────────────────────────────────────────────────

let voice: SpeechSynthesisVoice | null | undefined;

function danishVoice(): SpeechSynthesisVoice | null {
  if (voice !== undefined && voice !== null) return voice;
  const voices = 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
  voice = voices.find((v) => /^da/i.test(v.lang)) ?? null;
  return voice;
}

export const hasDanishVoice = () => !!danishVoice();

export function say(text: string) {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'da-DK';
    const v = danishVoice();
    if (v) u.voice = v;
    u.rate = 0.95;
    speechSynthesis.speak(u);
  } catch {
    // Ingen stemme.
  }
}

// ─── Planlægning langs tidslinjen ───────────────────────────────────────────

const LOOKAHEAD_MS = 15_000;

interface Scheduled {
  key: number;
  startAt: number;
  nodes: OscillatorNode[];
  timers: ReturnType<typeof setTimeout>[];
}

/**
 * Holder lydene planlagt for en kørende rutine. `update` kaldes ved hver ændring (start, pause, spring) og
 * jævnligt: fremtidige lyde aflyses og planlægges igen ud fra den nye position; lyde der allerede er spillet,
 * spilles ikke igen (medmindre man springer tilbage forbi dem).
 */
export class CueScheduler {
  private scheduled: Scheduled[] = [];
  private played = new Set<number>();
  private lastElapsed = 0;

  update(cues: YogaCue[], elapsedMs: number, playing: boolean, opts: { sound: boolean; voice: boolean }) {
    this.cancelFuture();
    // Tilbage i tiden: de lyde man springer tilbage forbi, må spilles igen.
    if (elapsedMs < this.lastElapsed - 500) for (const k of [...this.played]) if (k > elapsedMs - 50) this.played.delete(k);
    this.lastElapsed = elapsedMs;
    if (!playing || (!opts.sound && !opts.voice)) return;
    const c = ctx;
    if (opts.sound && c && c.state === 'suspended') void c.resume();
    for (const [i, cue] of cues.entries()) {
      const key = cue.atMs * 100 + (i % 100);
      if (this.played.has(key) || cue.atMs < elapsedMs - 60 || cue.atMs > elapsedMs + LOOKAHEAD_MS) continue;
      const delay = Math.max(0, cue.atMs - elapsedMs);
      const entry: Scheduled = { key, startAt: performance.now() + delay, nodes: [], timers: [] };
      if (opts.sound && c) entry.nodes = play(c, cue.sound, c.currentTime + delay / 1000);
      if (opts.voice && cue.say) {
        const text = cue.say;
        // Stemmen lidt efter klokken, så de ikke overdøver hinanden.
        entry.timers.push(setTimeout(() => say(text), delay + (opts.sound ? 450 : 0)));
      }
      // Telefoner der kan, summer også ved skift af side (ikke iPhone).
      if (cue.sound === 'skift' && 'vibrate' in navigator) entry.timers.push(setTimeout(() => navigator.vibrate?.([80, 60, 80]), delay));
      this.scheduled.push(entry);
    }
  }

  /** Aflyser lyde der ikke er begyndt; dem der er spillet, huskes. */
  private cancelFuture() {
    const now = performance.now();
    for (const s of this.scheduled) {
      if (s.startAt <= now + 10) {
        this.played.add(s.key);
        continue;
      }
      for (const n of s.nodes)
        try {
          n.stop();
        } catch {
          // Allerede stoppet.
        }
      s.timers.forEach(clearTimeout);
    }
    this.scheduled = [];
  }

  stop() {
    this.cancelFuture();
    try {
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    } catch {
      // Ingen stemme.
    }
  }
}

// ─── Indstillinger ──────────────────────────────────────────────────────────

export interface SoundPrefs {
  sound: boolean;
  voice: boolean;
}

const KEY = 'traeningsnav.yoga.lyd';

export function loadSoundPrefs(): SoundPrefs {
  try {
    return { sound: true, voice: true, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<SoundPrefs>) };
  } catch {
    return { sound: true, voice: true };
  }
}

export function saveSoundPrefs(p: SoundPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Privat tilstand.
  }
}
