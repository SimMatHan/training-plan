import { Check } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { ExerciseKind } from '../../shared/plan.schema';
import type { SetLog } from '../../shared/records.schema';
import { formatRange, type SetRow as Row } from '../../shared/resolve';
import type { Ghost } from '../logic/lastTime';
import { formatDecimal } from '../logic/numbers';
import { wheelValues } from '../logic/wheel';
import { Wheel } from '../ui/Wheel';

export type SetValues = Pick<SetLog, 'weight_kg' | 'reps' | 'seconds'>;
type Patch = Partial<SetValues & Pick<SetLog, 'done'>>;

const sideName = (side: Row['side']) => (side === 'H' ? 'Højre' : side === 'V' ? 'Venstre' : '');

/** Det hjulene viser: det loggede, ellers sidste gang, ellers planens mål. */
function initial(log: SetLog | undefined, ghost: Ghost | undefined, row: Row): SetValues {
  return {
    weight_kg: log?.weight_kg ?? ghost?.weight_kg ?? null,
    reps: log?.reps ?? ghost?.reps ?? row.reps?.max ?? null,
    seconds: log?.seconds ?? ghost?.seconds ?? row.seconds?.max ?? null,
  };
}

export function describeSet(v: SetValues, kind: ExerciseKind) {
  if (kind === 'time') return v.seconds != null ? `${v.seconds} sek` : '–';
  const reps = v.reps != null ? `${v.reps} reps` : '–';
  return kind === 'weight_reps' && v.weight_kg != null ? `${formatDecimal(v.weight_kg)} kg × ${v.reps ?? '–'}` : reps;
}

/**
 * Ét sæt. Det aktive sæt viser talhjul (vægt og reps, eller sekunder) centreret på sidste
 * gangs værdi, så et sæt magen til sidst er ét tryk på ✓. De øvrige er en kort linje; tryk
 * på linjen gør sættet aktivt.
 */
export function SetRow({
  row,
  kind,
  step,
  log,
  ghost,
  active,
  onActivate,
  onPatch,
  onDone,
}: {
  row: Row;
  kind: ExerciseKind;
  /** Vægttrin i kg. */
  step: number;
  log: SetLog | undefined;
  ghost: Ghost | undefined;
  active: boolean;
  onActivate: () => void;
  onPatch: (p: Patch) => void;
  /** ✓: gemmer de viste tal sammen med done. */
  onDone: (done: boolean, values: SetValues) => void;
}) {
  const [values, setValues] = useState(() => initial(log, ghost, row));
  // Optimistisk ✓, så to hurtige tryk ikke læser en forældet værdi.
  const [done, setDone] = useState(!!log?.done);
  useEffect(() => setDone(!!log?.done), [log?.done]);
  // Nyt fra databasen (fx "Samme som sidst" eller sync) eller sidste gang indlæst.
  useEffect(() => setValues(initial(log, ghost, row)), [log?.weight_kg, log?.reps, log?.seconds, ghost?.weight_kg, ghost?.reps, ghost?.seconds]);

  const name = `Sæt ${row.setNo}${row.side ? ` ${sideName(row.side).toLowerCase()}` : ''}`;
  const timed = kind === 'time';
  const target = timed ? formatRange(row.seconds, ' sek') : formatRange(row.reps, ' reps');
  const change = (p: Partial<SetValues>) => {
    setValues((v) => ({ ...v, ...p }));
    onPatch(p);
  };
  const toggle = () => {
    setDone(!done);
    onDone(!done, values);
  };

  const label = (
    <span className="min-w-0 flex-1">
      <span className="block text-row">
        Sæt {row.setNo}
        {row.side && <span className="text-ink-2"> · {sideName(row.side)}</span>}
      </span>
      <span className="num block text-footnote text-ink-2">
        {row.optional ? 'valgfrit · ' : ''}mål {target}
      </span>
    </span>
  );

  const check = (
    <button
      type="button"
      aria-pressed={done}
      aria-label={`${name} færdigt`}
      onClick={toggle}
      className={`grid size-11 shrink-0 place-items-center rounded-full transition-colors duration-200 ease-ios ${done ? 'animate-pop bg-status-green text-on-brand' : 'text-ink-3 ring-2 ring-separator ring-inset'}`}
    >
      <Check size={22} weight="bold" aria-hidden="true" />
    </button>
  );

  if (!active)
    return (
      <li className={`flex min-h-14 items-center gap-3 px-4 py-2 ${row.optional && !log ? 'opacity-60' : ''}`}>
        <button type="button" onClick={onActivate} aria-label={`${name}: ret`} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {label}
          <span className={`num text-row ${done ? '' : 'text-ink-2'}`}>{describeSet(values, kind)}</span>
        </button>
        {check}
      </li>
    );

  return (
    <li className="px-4 pt-3 pb-4">
      <div className="mb-2 flex items-center">{label}</div>
      <div className="flex items-center gap-2">
        {kind === 'weight_reps' && (
          <>
            <Wheel
              className="min-w-0 flex-[1.2]"
              label={`${name}, kg`}
              decimal
              values={[null, ...wheelValues({ value: values.weight_kg, step, min: step })]}
              value={values.weight_kg}
              onChange={(v) => change({ weight_kg: v })}
            />
            <span className="w-6 text-secondary text-ink-2">kg</span>
          </>
        )}
        <Wheel
          className="min-w-0 flex-1"
          label={`${name}, ${timed ? 'sekunder' : 'reps'}`}
          values={timed ? wheelValues({ value: values.seconds, step: 5, floor: 120 }) : wheelValues({ value: values.reps, step: 1, floor: 30 })}
          value={timed ? values.seconds : values.reps}
          onChange={(v) => change(timed ? { seconds: v } : { reps: v })}
        />
        <span className="w-9 text-secondary text-ink-2">{timed ? 'sek' : 'reps'}</span>
        {check}
      </div>
    </li>
  );
}
