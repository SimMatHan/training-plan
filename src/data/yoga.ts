// Afspilleren til en yogarutine: tilstanden (spiller/pause og hvor langt) pr. træning, gemt i localStorage
// som pausetimeren, så den overlever slukket skærm og genstart. Plus cast til TV: telefonen sender sin
// tilstand til Worker'en, og TV'et regner selv nedtællingen ud.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { YogaRoutine } from '../../shared/plan.schema';
import { buildSteps, cuesFor, positionAt, skipTarget, totalMs, type YogaCue, type YogaPosition, type YogaStep } from '../../shared/yoga';
import { api, athleteApi } from '../lib/api';
import { CueScheduler, unlockYogaAudio, type SoundPrefs } from '../lib/yogaSound';

export interface PlayerState {
  playing: boolean;
  /** Forløbet tid i rutinen på tidspunktet `at` (Date.now()). */
  elapsedMs: number;
  at: number;
}

export const elapsedOf = (s: PlayerState, now = Date.now()) => (s.playing ? s.elapsedMs + (now - s.at) : s.elapsedMs);

const key = (uuid: string) => `traeningsnav.yoga.${uuid}`;

function load(uuid: string): PlayerState {
  try {
    const raw = localStorage.getItem(key(uuid));
    if (raw) return JSON.parse(raw) as PlayerState;
  } catch {
    // Privat tilstand.
  }
  return { playing: false, elapsedMs: 0, at: Date.now() };
}

/** Gen-render så længe `live` er sand (4 gange i sekundet), og når appen kommer frem igen. */
export function useTicker(live: boolean, ms = 250) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!live) return;
    const tick = () => setN((n) => n + 1);
    const id = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [live, ms]);
}

export interface YogaTimeline {
  steps: YogaStep[];
  cues: YogaCue[];
  total: number;
}

export function useTimeline(routine: YogaRoutine | undefined): YogaTimeline | undefined {
  return useMemo(() => {
    if (!routine) return undefined;
    const steps = buildSteps(routine);
    return { steps, cues: cuesFor(routine, steps), total: totalMs(steps) };
  }, [routine]);
}

/** Afspilleren på telefonen. */
export function useYogaPlayer(uuid: string, timeline: YogaTimeline) {
  const [state, setState] = useState<PlayerState>(() => load(uuid));
  useTicker(state.playing);

  const save = useCallback(
    (next: PlayerState) => {
      setState(next);
      try {
        localStorage.setItem(key(uuid), JSON.stringify(next));
      } catch {
        // Privat tilstand: kun i hukommelsen.
      }
    },
    [uuid],
  );

  const elapsed = Math.min(elapsedOf(state), timeline.total);
  const pos: YogaPosition = positionAt(timeline.steps, elapsed);

  // Slut: stop uret ved enden.
  useEffect(() => {
    if (state.playing && pos.done) save({ playing: false, elapsedMs: timeline.total, at: Date.now() });
  }, [state.playing, pos.done, timeline.total, save]);

  const seek = (ms: number, playing = state.playing) => save({ playing, elapsedMs: Math.max(0, Math.min(ms, timeline.total)), at: Date.now() });
  return {
    state,
    elapsed,
    pos,
    play() {
      unlockYogaAudio();
      seek(pos.done ? 0 : elapsed, true);
    },
    pause: () => seek(elapsed, false),
    next: () => seek(skipTarget(timeline.steps, elapsed, 1)),
    prev: () => seek(skipTarget(timeline.steps, elapsed, -1)),
    restart: () => save({ playing: false, elapsedMs: 0, at: Date.now() }),
    seek,
  };
}

/** Holder lydene planlagt ud fra positionen. `enabled` false: stille (fx når TV'et spiller lyden). */
export function useCueSound(timeline: YogaTimeline | undefined, elapsed: number, playing: boolean, prefs: SoundPrefs, enabled = true) {
  const scheduler = useRef<CueScheduler>(null);
  scheduler.current ??= new CueScheduler();
  const elapsedRef = useRef(elapsed);
  elapsedRef.current = elapsed;
  const on = enabled && playing;
  // Planlæg forfra ved hver ændring af tilstanden og hvert 5. sekund.
  const bucket = Math.floor(elapsed / 5000);
  const jumpKey = Math.round(elapsed / 1000) - Math.round(performance.now() / 1000);
  useEffect(() => {
    if (!timeline) return;
    scheduler.current!.update(timeline.cues, elapsedRef.current, on, { sound: prefs.sound, voice: prefs.voice });
    // jumpKey ændres, når positionen springer i forhold til uret (spring frem/tilbage).
  }, [timeline, on, prefs.sound, prefs.voice, bucket, jumpKey]);
  useEffect(() => () => scheduler.current?.stop(), []);
}

// ─── Cast til TV ────────────────────────────────────────────────────────────

export interface CastInfo {
  token: string;
  code: string;
}

export interface CastView {
  title: string;
  routine: YogaRoutine;
  state: { playing: boolean; elapsedMs: number; tvSound: boolean };
  stateAt: number;
  serverNow: number;
  tvSeenAt: number | null;
  ended: boolean;
}

const castKey = (uuid: string) => `traeningsnav.cast.${uuid}`;

function loadCast(uuid: string): CastInfo | null {
  try {
    return JSON.parse(sessionStorage.getItem(castKey(uuid)) ?? 'null') as CastInfo | null;
  } catch {
    return null;
  }
}

/**
 * Cast fra telefonen: opret (giver kode og link), send tilstanden ved hver ændring og hvert 15. sekund
 * (så TV'et kan ses som forbundet, og casten ikke udløber), og afslut.
 */
export function useCast(slug: string, uuid: string, title: string, routine: YogaRoutine, state: PlayerState, elapsed: number) {
  const [cast, setCast] = useState<CastInfo | null>(() => loadCast(uuid));
  const [tvSound, setTvSound] = useState(true);
  const [tvSeenAt, setTvSeenAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const elapsedRef = useRef(elapsed);
  elapsedRef.current = elapsed;
  const playingRef = useRef(state.playing);
  playingRef.current = state.playing;

  const remember = (c: CastInfo | null) => {
    setCast(c);
    try {
      if (c) sessionStorage.setItem(castKey(uuid), JSON.stringify(c));
      else sessionStorage.removeItem(castKey(uuid));
    } catch {
      // Privat tilstand.
    }
  };

  const body = () => ({ playing: playingRef.current, elapsedMs: Math.round(elapsedRef.current), tvSound });

  async function start() {
    setError(null);
    try {
      const sent = Date.now();
      const r = await athleteApi<CastInfo & { serverNow: number }>(slug, '/cast', { method: 'POST', json: { title, routine, state: body() } });
      setOffset(r.serverNow - (sent + Date.now()) / 2);
      remember({ token: r.token, code: r.code });
      return r;
    } catch (e) {
      setError((e as Error).message === 'Ingen forbindelse' ? 'Cast kræver net.' : (e as Error).message);
      return null;
    }
  }

  async function stop() {
    const c = cast;
    remember(null);
    setTvSeenAt(null);
    if (c) await athleteApi(slug, `/cast/${c.token}`, { method: 'DELETE' }).catch(() => {});
  }

  const push = useCallback(async () => {
    if (!cast) return;
    try {
      const r = await athleteApi<{ serverNow: number; tvSeenAt: number | null }>(slug, `/cast/${cast.token}`, { method: 'PUT', json: body() });
      setTvSeenAt(r.tvSeenAt);
      setError(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 404 || status === 409) remember(null);
      else setError('TV’et kan ikke nås lige nu (ingen net?).');
    }
    // body() læser refs; tvSound er med i afhængighederne.
  }, [cast, slug, tvSound]);

  // Ved hver ændring af afspilleren (start, pause, spring) og af TV-lyden.
  useEffect(() => {
    void push();
  }, [push, state.playing, state.at]);

  // Hjerteslag.
  useEffect(() => {
    if (!cast) return;
    const id = setInterval(() => void push(), 15_000);
    return () => clearInterval(id);
  }, [cast, push]);

  const connected = !!tvSeenAt && Date.now() + offset - tvSeenAt < 30_000;
  return { cast, start, stop, tvSound, setTvSound, connected, error };
}

/** TV'et: henter tilstanden hvert halvandet sekund og regner med serverens ur. */
export function useCastFollower(token: string | undefined) {
  const [view, setView] = useState<CastView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!token) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const sent = Date.now();
        const v = await api<CastView>(`/cast/${token}`, { anonymous: true });
        if (stopped) return;
        setOffset(v.serverNow - (sent + Date.now()) / 2);
        setView(v);
        setError(null);
        if (v.ended) return;
      } catch (e) {
        if (stopped) return;
        setError((e as { status?: number }).status === 404 ? 'Casten findes ikke eller er udløbet.' : 'Ingen forbindelse. Prøver igen …');
        if ((e as { status?: number }).status === 404) return;
      }
      timer = setTimeout(poll, document.visibilityState === 'visible' ? 1500 : 5000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [token]);

  const elapsed = view ? (view.state.playing ? view.state.elapsedMs + (Date.now() + offset - view.stateAt) : view.state.elapsedMs) : 0;
  return { view, error, elapsed };
}
