import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { extendTimer, skipTimer, useTimer } from '../data/timer';
import { SecondaryButton, SmallButton } from '../ui/Button';
import { Ring } from '../ui/Ring';

const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Pausetimeren: glider op i et ark nederst, når et sæt er markeret ✓. Stor nedtælling i en
 * gradient-ring, der tømmes. Kan foldes sammen til en lav bjælke, så sættene kan ses.
 */
export function RestTimer({ compact, onToggle }: { compact: boolean; onToggle: () => void }) {
  const { state, remainingMs, finished } = useTimer();
  if (!state) return null;
  const progress = state.durationSec ? remainingMs / (state.durationSec * 1000) : 0;
  const time = finished ? '0:00' : mmss(remainingMs);
  const title = finished ? 'Pausen er slut' : `Pause · ${state.label}`;

  return (
    <div role="timer" aria-live={finished ? 'assertive' : 'off'} aria-label={`${title}, ${time}`} className="pb-safe animate-sheet fixed inset-x-0 bottom-0 z-30 rounded-t-card bg-surface shadow-float">
      <div className="mx-auto max-w-xl px-4 pt-1.5 pb-4">
        <button type="button" onClick={onToggle} aria-expanded={!compact} aria-label={compact ? 'Vis pausetimeren' : 'Fold pausetimeren sammen'} className="mx-auto flex h-6 w-16 items-center justify-center text-ink-3">
          {compact ? <CaretUp size={18} weight="bold" /> : <CaretDown size={18} weight="bold" />}
        </button>
        {compact ? (
          <div className="flex items-center gap-3">
            <Ring progress={progress} size={44} stroke={5} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-footnote text-ink-2">{title}</p>
              <p className="num text-title">{time}</p>
            </div>
            {!finished && <SmallButton onClick={() => extendTimer(30)}>+30 s</SmallButton>}
            <SmallButton onClick={skipTimer}>{finished ? 'Luk' : 'Spring over'}</SmallButton>
          </div>
        ) : (
          <>
            <p className="mb-3 truncate text-center text-secondary text-ink-2">{title}</p>
            <Ring progress={progress} size={184} stroke={12} className="mx-auto">
              <span className="num text-[48px] leading-none font-bold tracking-[-0.03em]">{time}</span>
            </Ring>
            <div className="mt-5 flex gap-2">
              <SecondaryButton onClick={skipTimer}>{finished ? 'Luk' : 'Spring over'}</SecondaryButton>
              <SecondaryButton onClick={() => extendTimer(30)}>+30 s</SecondaryButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
