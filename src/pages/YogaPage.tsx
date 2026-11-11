import { ArrowCounterClockwise, CaretDown, Pause, Play, Screencast, ShareNetwork, SkipBack, SkipForward, SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import type { Session } from '../../shared/plan.schema';
import type { Workout } from '../../shared/records.schema';
import { AREA_SHORT, poseName, poseSides, SIDE_LABEL } from '../../shared/yoga';
import { NoteField } from '../components/NoteField';
import { clockText, RoutineBar, useLandscape, YogaStage } from '../components/YogaStage';
import { finishWorkout, patchWorkout } from '../data/workouts';
import { useCast, useCueSound, useTimeline, useYogaPlayer } from '../data/yoga';
import { useWakeLock } from '../lib/wakeLock';
import { hasDanishVoice, loadSoundPrefs, previewSound, saveSoundPrefs, unlockYogaAudio, type SoundPrefs } from '../lib/yogaSound';
import { illustrationFor } from '../logic/illustrations';
import { PrimaryButton, SecondaryButton, smallButton, TextButton } from '../ui/Button';
import { Switch } from '../ui/Field';
import { Figure } from '../ui/Figure';
import { Card, Group, InsetList } from '../ui/InsetList';
import { Muted } from '../ui/Screen';
import { Sheet } from '../ui/Sheet';

type YogaSession = Extract<Session, { kind: 'mobilitet' }> & { yoga: NonNullable<Extract<Session, { kind: 'mobilitet' }>['yoga']> };

const iconButton = 'grid size-10 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-pill';

/**
 * Yogarutinen: oversigt før start, derefter afspilleren med figur, nedtælling og lyde (klokke ved næste
 * stilling, ding-dong ved skift af side, tik før start, gong til sidst) og evt. stemme. Kan vises på et TV
 * (cast med kode, Chromecast fra Chrome, eller skærmspejling), mens telefonen er fjernbetjening.
 */
export function YogaPage({ workout, session, slug }: { workout: Workout; session: YogaSession; slug: string }) {
  const [, navigate] = useLocation();
  const routine = session.yoga;
  const timeline = useTimeline(routine)!;
  const player = useYogaPlayer(workout.uuid, timeline);
  const [prefs, setPrefsState] = useState<SoundPrefs>(loadSoundPrefs);
  const setPrefs = (p: SoundPrefs) => {
    setPrefsState(p);
    saveSoundPrefs(p);
  };
  const cast = useCast(slug, workout.uuid, session.name, routine, player.state, player.elapsed);
  // Spiller TV'et lyden, er telefonen stille, så de ikke ekkoer.
  const tvPlaysSound = !!cast.cast && cast.connected && cast.tvSound;
  useCueSound(timeline, player.elapsed, player.state.playing, prefs, !tvPlaysSound);
  useWakeLock(true);
  const wide = useLandscape();
  const [castOpen, setCastOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const { pos, state } = player;
  const started = player.elapsed > 0 || state.playing;
  const showFinish = finishing || pos.done;
  const minutes = Math.round(timeline.total / 60_000);

  async function save() {
    await patchWorkout(workout.uuid, { duration_sec: Math.round(player.elapsed / 1000) });
    await finishWorkout(workout.uuid);
    if (cast.cast) await cast.stop();
    navigate('/');
  }

  const header = (
    <header className="pt-safe sticky top-0 z-20 -mx-4 border-b-[0.5px] border-separator bg-bg px-3">
      <div className="flex h-14 items-center gap-2">
        <Link href="/" aria-label="Til I dag" className={iconButton}>
          <CaretDown size={20} weight="bold" aria-hidden="true" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-headline">{session.name}</h1>
        <button type="button" onClick={() => setSoundOpen(true)} aria-label="Lyd" className={iconButton}>
          {prefs.sound || prefs.voice ? <SpeakerHigh size={20} aria-hidden="true" /> : <SpeakerSlash size={20} aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => setCastOpen(true)}
          aria-label={cast.cast ? 'TV-visning er tændt' : 'Vis på TV'}
          className={`${iconButton} ${cast.cast ? 'text-brand-red' : ''}`}
        >
          <Screencast size={20} weight={cast.cast ? 'fill' : 'regular'} aria-hidden="true" />
        </button>
        {started && !showFinish && (
          <button type="button" onClick={() => (player.pause(), setFinishing(true))} className={smallButton('secondary', 'min-h-10 shrink-0 px-4')}>
            Afslut
          </button>
        )}
      </div>
    </header>
  );

  const controls = (
    <div className="flex items-center justify-center gap-6">
      <button type="button" onClick={player.prev} aria-label="Forrige stilling" className="grid size-14 place-items-center rounded-full bg-fill text-ink">
        <SkipBack size={26} weight="fill" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={state.playing ? player.pause : player.play}
        aria-label={state.playing ? 'Pause' : 'Fortsæt'}
        className="grid size-20 place-items-center rounded-full bg-brand text-on-brand shadow-float active:scale-95"
      >
        {state.playing ? <Pause size={36} weight="fill" aria-hidden="true" /> : <Play size={36} weight="fill" aria-hidden="true" />}
      </button>
      <button type="button" onClick={player.next} aria-label="Næste stilling" className="grid size-14 place-items-center rounded-full bg-fill text-ink">
        <SkipForward size={26} weight="fill" aria-hidden="true" />
      </button>
    </div>
  );

  const sheets = (
    <>
      <CastSheet open={castOpen} onClose={() => setCastOpen(false)} cast={cast} />
      <SoundSheet open={soundOpen} onClose={() => setSoundOpen(false)} prefs={prefs} setPrefs={setPrefs} tvPlaysSound={tvPlaysSound} />
    </>
  );

  // Telefonen på langs (fx spejlet til et TV): hele skærmen til rutinen, små knapper nederst.
  if (wide && started && !showFinish)
    return (
      <main className="fixed inset-0 flex flex-col bg-bg text-ink">
        <div className="flex items-center gap-3 px-6 pt-3">
          <Link href="/" aria-label="Til I dag" className={iconButton}>
            <CaretDown size={20} weight="bold" aria-hidden="true" />
          </Link>
          <p className="min-w-0 flex-1 truncate text-headline">{session.name}</p>
          <button type="button" onClick={player.prev} aria-label="Forrige stilling" className={iconButton}>
            <SkipBack size={20} weight="fill" aria-hidden="true" />
          </button>
          <button type="button" onClick={state.playing ? player.pause : player.play} aria-label={state.playing ? 'Pause' : 'Fortsæt'} className={`${iconButton} bg-brand! text-on-brand`}>
            {state.playing ? <Pause size={20} weight="fill" aria-hidden="true" /> : <Play size={20} weight="fill" aria-hidden="true" />}
          </button>
          <button type="button" onClick={player.next} aria-label="Næste stilling" className={iconButton}>
            <SkipForward size={20} weight="fill" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <YogaStage routine={routine} steps={timeline.steps} pos={pos} wide paused={!state.playing} />
        </div>
        <div className="px-6 pb-3">
          <RoutineBar pos={pos} />
        </div>
        {sheets}
      </main>
    );

  return (
    <main className={`mx-auto max-w-xl px-4 ${started && !showFinish ? 'pb-44' : 'pb-12'}`}>
      {header}

      {showFinish ? (
        <FinishYoga
          workout={workout}
          minutes={Math.round(player.elapsed / 60_000)}
          complete={pos.done}
          onSave={() => void save()}
          onResume={() => setFinishing(false)}
          onRestart={() => {
            player.restart();
            setFinishing(false);
          }}
        />
      ) : !started ? (
        <Overview session={session} minutes={minutes} onStart={player.play} onCast={() => setCastOpen(true)} casting={!!cast.cast} finished={!!workout.finished_at} />
      ) : (
        <>
          <div className="pt-4">
            <YogaStage routine={routine} steps={timeline.steps} pos={pos} wide={false} paused={!state.playing} />
          </div>
          <div className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t-[0.5px] border-separator bg-bg px-4 pt-3">
            <div className="mx-auto flex max-w-xl flex-col gap-3 pb-3">
              <div className="flex items-center gap-3">
                <RoutineBar pos={pos} />
                <span className="num shrink-0 text-footnote text-ink-2">{clockText(pos.totalMs - pos.elapsedMs)}</span>
              </div>
              {controls}
            </div>
          </div>
        </>
      )}
      {sheets}
    </main>
  );
}

/** Før start: hvor lang tid, hvilke områder, alle stillinger med tid, og Start. */
function Overview({ session, minutes, onStart, onCast, casting, finished }: { session: YogaSession; minutes: number; onStart: () => void; onCast: () => void; casting: boolean; finished: boolean }) {
  const routine = session.yoga;
  return (
    <div className="pt-4">
      <Card className="mb-6">
        <p className="text-footnote font-semibold tracking-wide text-ink-2 uppercase">Yoga og mobilitet</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="num text-hero text-gradient">{minutes}</span>
          <span className="text-unit text-ink-2">min</span>
        </p>
        <p className="mt-2 text-secondary text-ink-2">
          {routine.poses.length} stillinger{routine.areas.length ? ` · fokus på ${routine.areas.map((a) => AREA_SHORT[a]).join(', ')}` : ''}
          {finished && ' · lavet i dag'}
        </p>
        {session.notes.map((n) => (
          <p key={n} className="mt-2 text-secondary text-ink">
            {n}
          </p>
        ))}
        <div className="mt-5 flex flex-col gap-3">
          <PrimaryButton onClick={onStart} className="gap-2">
            <Play size={20} weight="fill" aria-hidden="true" /> {finished ? 'Kør rutinen igen' : 'Start rutinen'}
          </PrimaryButton>
          <SecondaryButton onClick={onCast} className="gap-2">
            <Screencast size={20} aria-hidden="true" /> {casting ? 'TV-visning er tændt' : 'Vis på TV'}
          </SecondaryButton>
        </div>
        <Muted className="mt-3">Lyd ved hvert skift, så du ikke behøver kigge. Telefonen holder skærmen tændt.</Muted>
      </Card>

      <Group title="Rutinen">
        <InsetList inset={84}>
          {routine.poses.map((p, i) => {
            const ill = illustrationFor(p.poseId, poseName(p));
            const sides = poseSides(p);
            const time =
              sides.length === 1
                ? `${p.seconds} s`
                : sides[0].seconds === sides[1].seconds
                  ? `${p.seconds} s/side`
                  : sides.map((s) => `${s.side === 'H' ? 'H' : 'V'} ${s.seconds} s`).join(' · ');
            return (
              <li key={`${p.poseId}-${i}`} className="flex min-h-16 items-center gap-3 px-4 py-2">
                <span className="grid h-12 w-[60px] shrink-0 place-items-center overflow-hidden rounded-tile bg-fill">
                  {ill && <Figure illustration={ill} label={poseName(p)} className="h-12 w-[60px]" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-row">{poseName(p)}</span>
                  {sides.length > 1 && sides[0].seconds !== sides[1].seconds && (
                    <span className="block text-footnote text-ink-2">Start med {SIDE_LABEL[sides[0].side!]} (strammest)</span>
                  )}
                </span>
                <span className="num shrink-0 text-secondary text-ink-2">{time}</span>
              </li>
            );
          })}
        </InsetList>
      </Group>
    </div>
  );
}

function FinishYoga({
  workout,
  minutes,
  complete,
  onSave,
  onResume,
  onRestart,
}: {
  workout: Workout;
  minutes: number;
  complete: boolean;
  onSave: () => void;
  onResume: () => void;
  onRestart: () => void;
}) {
  return (
    <div className="flex flex-col gap-6 pt-6">
      <Card>
        <h2 className="text-title">{complete ? 'Færdig. Godt arbejde.' : 'Afslut rutinen'}</h2>
        <p className="mt-1 text-secondary text-ink-2">
          {minutes} min{complete ? '' : ' indtil nu'}
          {workout.finished_at && ' · gemt som lavet'}
        </p>
      </Card>
      <NoteField label="Note (fx hvad der var stramt)" value={workout.note} onSave={(note) => void patchWorkout(workout.uuid, { note })} />
      {!workout.finished_at ? <PrimaryButton onClick={onSave}>Gem som lavet</PrimaryButton> : <PrimaryButton onClick={onSave}>Til I dag</PrimaryButton>}
      {!complete && <SecondaryButton onClick={onResume}>Fortsæt rutinen</SecondaryButton>}
      <TextButton onClick={onRestart} className="gap-1.5 self-start">
        <ArrowCounterClockwise size={18} aria-hidden="true" /> Start forfra
      </TextButton>
    </div>
  );
}

// ─── Cast ───────────────────────────────────────────────────────────────────

interface PresentationRequestLike {
  start(): Promise<unknown>;
}

/** Chrome (Android og computer) kan caste en side direkte til et Chromecast-TV. */
const presentationSupported = () => typeof window !== 'undefined' && 'PresentationRequest' in window;

function CastSheet({ open, onClose, cast }: { open: boolean; onClose: () => void; cast: ReturnType<typeof useCast> }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = cast.cast ? `${location.origin}/tv/${cast.cast.token}` : '';

  async function start() {
    setBusy(true);
    unlockYogaAudio();
    await cast.start();
    setBusy(false);
  }

  async function chromecast() {
    if (!cast.cast) return;
    try {
      const Ctor = (window as unknown as { PresentationRequest: new (urls: string[]) => PresentationRequestLike }).PresentationRequest;
      await new Ctor([link]).start();
    } catch {
      // Afbrudt af brugeren eller intet TV fundet.
    }
  }

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: 'Yoga på TV', url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      }
    } catch {
      // Afbrudt.
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Vis på TV">
      {!cast.cast ? (
        <div className="flex flex-col gap-4">
          <p className="text-body">TV'et viser stillingen, figuren og nedtællingen i stort. Telefonen er fjernbetjening: start, pause og spring over.</p>
          <PrimaryButton onClick={() => void start()} disabled={busy} className="gap-2">
            <Screencast size={20} aria-hidden="true" /> Start TV-visning
          </PrimaryButton>
          {cast.error && <p className="text-secondary text-danger">{cast.error}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className={`text-secondary font-semibold ${cast.connected ? 'text-status-green' : 'text-ink-2'}`} role="status">
            {cast.connected ? '● TV’et er forbundet' : '○ Venter på TV’et …'}
          </p>
          <div className="rounded-card bg-fill p-4 text-center">
            <p className="text-secondary text-ink-2">
              Åbn <span className="font-semibold text-ink">{location.host}/tv</span> i TV'ets browser og skriv
            </p>
            <p className="num mt-1 text-[44px] leading-tight font-bold tracking-[0.12em]" aria-label={`Kode ${cast.cast.code.split('').join(' ')}`}>
              {cast.cast.code.slice(0, 3)} {cast.cast.code.slice(3)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {presentationSupported() && (
              <button type="button" onClick={() => void chromecast()} className={smallButton('primary', 'gap-1.5')}>
                <Screencast size={16} weight="bold" aria-hidden="true" /> Cast til Chromecast
              </button>
            )}
            <button type="button" onClick={() => void share()} className={smallButton('secondary', 'gap-1.5')}>
              <ShareNetwork size={16} weight="bold" aria-hidden="true" /> {copied ? 'Link kopieret' : 'Del link'}
            </button>
          </div>
          <Switch checked={cast.tvSound} onChange={cast.setTvSound} label="Lyd på TV'et (telefonen er stille imens)" />
          {cast.error && <p className="text-secondary text-danger">{cast.error}</p>}
          <TextButton danger onClick={() => void cast.stop()} className="self-start">
            Stop TV-visning
          </TextButton>
        </div>
      )}
      <div className="mt-6 border-t-[0.5px] border-separator pt-4">
        <h3 className="mb-1 text-headline">Apple TV eller AirPlay-TV</h3>
        <p className="text-secondary text-ink-2">
          Kontrolcenter → Skærmspejling → vælg TV'et. Vend telefonen på langs, så fylder rutinen hele TV'et. Ingen kode nødvendig.
        </p>
      </div>
    </Sheet>
  );
}

function SoundSheet({ open, onClose, prefs, setPrefs, tvPlaysSound }: { open: boolean; onClose: () => void; prefs: SoundPrefs; setPrefs: (p: SoundPrefs) => void; tvPlaysSound: boolean }) {
  return (
    <Sheet open={open} onClose={onClose} title="Lyd">
      <div className="flex flex-col gap-4">
        {tvPlaysSound && <p className="text-secondary text-ink-2">Lyden spiller på TV'et lige nu. Slå "Lyd på TV'et" fra under Vis på TV for at høre den her.</p>}
        <Switch checked={prefs.sound} onChange={(sound) => setPrefs({ ...prefs, sound })} label="Lyde ved skift" />
        <Switch checked={prefs.voice} onChange={(voice) => setPrefs({ ...prefs, voice })} label="Stemme (læser næste stilling op)" />
        {prefs.voice && !hasDanishVoice() && <Muted>Telefonen har ingen dansk stemme installeret; den bruger standardstemmen.</Muted>}
        <div>
          <p className="mb-2 text-footnote text-ink-2">Lyt</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['naeste', 'Næste stilling'],
                ['skift', 'Skift side'],
                ['tick', 'Nedtælling'],
                ['start', 'Start'],
                ['halvvejs', 'Halvvejs'],
                ['faerdig', 'Færdig'],
              ] as const
            ).map(([s, label]) => (
              <button key={s} type="button" onClick={() => previewSound(s)} className={smallButton('secondary')}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <Muted>Sæt telefonen på lydløs-knappen fra: iPhone afspiller ikke lyde fra apps i lydløs.</Muted>
      </div>
    </Sheet>
  );
}
