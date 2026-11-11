import { Screencast, SpeakerHigh } from '@phosphor-icons/react';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { AREA_SHORT, positionAt } from '../../shared/yoga';
import { RoutineBar, YogaStage } from '../components/YogaStage';
import { useCastFollower, useCueSound, useTicker, useTimeline } from '../data/yoga';
import { api, ApiError } from '../lib/api';
import { useWakeLock } from '../lib/wakeLock';
import { audioReady, unlockYogaAudio } from '../lib/yogaSound';
import { PrimaryButton } from '../ui/Button';

/** TV'et er altid mørkt: mindre blænding i stuen. */
function useDarkTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.dataset.theme;
    root.dataset.theme = 'dark';
    return () => {
      if (before) root.dataset.theme = before;
      else delete root.dataset.theme;
    };
  }, []);
}

/**
 * TV-visning: /tv viser et felt til koden fra telefonen; /tv/<token> følger rutinen. Ingen login: tokenet er
 * hemmeligt og gælder kun den ene cast. Virker i en smart-TV-browser, på en computer med HDMI og på et
 * Chromecast-TV (castet fra Chrome).
 */
export function TvPage({ token }: { token?: string }) {
  useDarkTheme();
  return token ? <TvFollow token={token} /> : <TvCode />;
}

function TvCode() {
  const [, navigate] = useLocation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) return setError('Koden har seks cifre.');
    setBusy(true);
    unlockYogaAudio();
    try {
      const { token } = await api<{ token: string }>(`/cast/kode/${digits}`, { anonymous: true });
      navigate(`/tv/${token}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ingen forbindelse.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-ink">
      <form onSubmit={submit} className="flex w-full max-w-xl flex-col items-center gap-6 text-center">
        <Screencast size={64} className="text-brand-red" aria-hidden="true" />
        <h1 className="text-[40px] leading-tight font-bold">Yoga på TV</h1>
        <p className="text-[22px] text-ink-2">Tryk på TV-ikonet i rutinen på telefonen og skriv koden her.</p>
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Kode fra telefonen"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 7));
            setError(null);
          }}
          placeholder="123 456"
          className="num w-full rounded-card bg-surface px-6 py-4 text-center text-[56px] font-bold tracking-[0.15em] text-ink outline-none focus:ring-4 focus:ring-brand-red"
        />
        {error && (
          <p role="alert" className="text-[22px] text-danger">
            {error}
          </p>
        )}
        <PrimaryButton type="submit" disabled={busy} className="min-h-16 text-[22px]">
          Forbind
        </PrimaryButton>
      </form>
    </main>
  );
}

function TvFollow({ token }: { token: string }) {
  const { view, error, elapsed } = useCastFollower(token);
  const timeline = useTimeline(view?.routine);
  const playing = !!view?.state.playing && !view.ended;
  useTicker(playing);
  useWakeLock(true);
  const [soundUnlocked, setSoundUnlocked] = useState(audioReady());
  const tvSound = !!view?.state.tvSound;
  const clamped = timeline ? Math.min(elapsed, timeline.total) : 0;
  useCueSound(timeline, clamped, playing, { sound: tvSound, voice: tvSound }, tvSound);

  if (!view || !timeline)
    return (
      <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center text-ink">
        <p className="text-[28px] text-ink-2">{error ?? 'Forbinder …'}</p>
      </main>
    );

  const pos = positionAt(timeline.steps, clamped);
  const started = clamped > 0 || playing;
  // Browsere afspiller først lyd efter et tryk; TV-fjernbetjeningens OK tæller.
  const needsTap = tvSound && !soundUnlocked && !view.ended;

  return (
    <main className="fixed inset-0 flex flex-col bg-bg text-ink" onClick={() => (unlockYogaAudio(), setSoundUnlocked(true))}>
      {view.ended ? (
        <Center title="TV-visningen er slut" sub="Start en ny fra telefonen." />
      ) : pos.done ? (
        <Center title="Færdig. Godt arbejde." sub={view.title} />
      ) : !started ? (
        <Center
          title={view.title}
          sub={`${Math.round(timeline.total / 60_000)} min · ${view.routine.poses.length} stillinger${view.routine.areas.length ? ` · ${view.routine.areas.map((a) => AREA_SHORT[a]).join(', ')}` : ''}`}
          hint="Tryk Start på telefonen"
        />
      ) : (
        <>
          <div className="min-h-0 flex-1 pt-[3vh]">
            <YogaStage routine={view.routine} steps={timeline.steps} pos={pos} wide paused={!playing} />
          </div>
          <div className="flex items-center gap-[2vw] px-[4vw] pb-[4vh]">
            {!playing && <span className="shrink-0 rounded-full bg-fill px-4 py-1 text-[2.6vh] font-semibold text-ink">Pause</span>}
            <RoutineBar pos={pos} />
          </div>
        </>
      )}
      {needsTap && (
        <button
          type="button"
          autoFocus
          onClick={() => (unlockYogaAudio(), setSoundUnlocked(true))}
          className="absolute top-[3vh] right-[3vw] inline-flex items-center gap-3 rounded-full bg-brand px-6 py-3 text-[2.6vh] font-semibold text-on-brand shadow-float"
        >
          <SpeakerHigh size={28} weight="fill" aria-hidden="true" /> Tryk OK for lyd
        </button>
      )}
      {error && <p className="absolute bottom-[1vh] left-[4vw] text-[2.2vh] text-ink-2">{error}</p>}
    </main>
  );
}

function Center({ title, sub, hint }: { title: string; sub?: string; hint?: string }) {
  return (
    <div className="grid h-full place-items-center px-[6vw] text-center">
      <div className="flex flex-col items-center gap-[2vh]">
        <h1 className="leading-tight font-bold" style={{ fontSize: 'min(9vh, 7vw)' }}>
          {title}
        </h1>
        {sub && (
          <p className="text-ink-2" style={{ fontSize: '3.4vh' }}>
            {sub}
          </p>
        )}
        {hint && (
          <p className="mt-[3vh] rounded-full bg-fill px-[3vw] py-[1.4vh] font-semibold" style={{ fontSize: '3vh' }}>
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
