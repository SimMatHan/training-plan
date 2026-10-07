import { resetTimer, skipTimer, useTimer } from '../data/timer';

const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Pausetimer nederst på skærmen. Vises kun mens en pause kører eller lige er slut. */
export function RestTimerBar() {
  const { state, remainingMs, finished } = useTimer();
  if (!state) return null;

  return (
    <div
      role="timer"
      aria-live={finished ? 'assertive' : 'off'}
      className={`pb-safe fixed inset-x-0 bottom-0 z-30 ${finished ? 'bg-mob text-white' : 'bg-fg text-bg'}`}
    >
      <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm opacity-80">{finished ? 'Pausen er slut' : `Pause · ${state.label}`}</div>
          <div className="num text-4xl leading-none font-bold">{finished ? '0:00' : mmss(remainingMs)}</div>
        </div>
        {!finished && (
          <button type="button" onClick={resetTimer} className="min-h-12 rounded-lg border border-current px-3 font-medium">
            Nulstil
          </button>
        )}
        <button type="button" onClick={skipTimer} className="min-h-12 rounded-lg border border-current px-3 font-medium">
          {finished ? 'Luk' : 'Spring over'}
        </button>
      </div>
    </div>
  );
}
