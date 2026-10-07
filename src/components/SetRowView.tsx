import { useEffect, useState } from 'react';
import type { ExerciseKind } from '../../shared/plan.schema';
import type { SetLog } from '../../shared/records.schema';
import { formatRange, type SetRow } from '../../shared/resolve';
import type { Ghost } from '../logic/lastTime';
import { formatDecimal } from '../logic/numbers';
import { NumberField } from './NumberField';

type Patch = Partial<Pick<SetLog, 'weight_kg' | 'reps' | 'seconds' | 'done'>>;

export const setGridCols = (kind: ExerciseKind) =>
  kind === 'weight_reps' ? 'grid-cols-[2.75rem_1fr_1fr_3.25rem_3.5rem]' : 'grid-cols-[2.75rem_1fr_3.25rem_3.5rem]';

/** Én sætrække: [sæt] [kg] [reps/sek] [som sidst] [✓]. */
export function SetRowView({
  row,
  kind,
  log,
  ghost,
  onPatch,
  onToggleDone,
}: {
  row: SetRow;
  kind: ExerciseKind;
  log: SetLog | undefined;
  ghost: Ghost | undefined;
  onPatch: (p: Patch) => void;
  onToggleDone: (done: boolean) => void;
}) {
  const name = `Sæt ${row.setNo}${row.side ? (row.side === 'H' ? ' højre' : ' venstre') : ''}`;
  const timed = kind === 'time';
  const amountGhost = timed ? ghost?.seconds : ghost?.reps;
  const target = timed ? row.seconds : row.reps;
  // Optimistisk ✓, så to hurtige tryk ikke læser en forældet værdi.
  const [done, setDone] = useState(!!log?.done);
  useEffect(() => setDone(!!log?.done), [log?.done]);
  const canCopy = !!ghost && (amountGhost != null || ghost.weight_kg != null);

  return (
    <div className={`grid items-center gap-2 ${setGridCols(kind)} ${row.optional && !log ? 'opacity-60' : ''}`}>
      <div className="num text-center leading-tight">
        <span className="text-xl font-bold">{row.setNo}</span>
        {row.side && <span className="text-base font-semibold text-muted">{row.side}</span>}
        {row.optional && <span className="block text-[11px] text-muted">valgfri</span>}
      </div>
      {kind === 'weight_reps' && (
        <NumberField
          decimal
          label={`${name}, kg`}
          value={log?.weight_kg ?? null}
          placeholder={ghost?.weight_kg != null ? formatDecimal(ghost.weight_kg) : ''}
          onValue={(v) => onPatch({ weight_kg: v })}
        />
      )}
      <NumberField
        label={`${name}, ${timed ? 'sekunder' : 'reps'}`}
        value={(timed ? log?.seconds : log?.reps) ?? null}
        placeholder={amountGhost != null ? String(amountGhost) : formatRange(target)}
        onValue={(v) => onPatch(timed ? { seconds: v } : { reps: v })}
      />
      <button
        type="button"
        disabled={!canCopy}
        onClick={() => ghost && onPatch(timed ? { seconds: ghost.seconds, weight_kg: ghost.weight_kg } : { reps: ghost.reps, weight_kg: ghost.weight_kg })}
        aria-label={`${name}: samme som sidst`}
        className="h-14 rounded-lg border border-line text-[11px] leading-tight font-medium disabled:opacity-25"
      >
        Samme som sidst
      </button>
      <button
        type="button"
        aria-pressed={done}
        aria-label={`${name} færdigt`}
        onClick={() => {
          setDone(!done);
          onToggleDone(!done);
        }}
        className={`flex h-14 items-center justify-center rounded-lg ${done ? 'bg-mob text-white' : 'border-2 border-line'}`}
      >
        <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7" className={done ? '' : 'opacity-30'} />
        </svg>
      </button>
    </div>
  );
}
