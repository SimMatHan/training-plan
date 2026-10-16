import { Check } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { ExerciseKind } from '../../shared/plan.schema';
import type { SetLog } from '../../shared/records.schema';
import type { SetRow as Row } from '../../shared/resolve';
import type { Ghost } from '../logic/lastTime';
import { formatDecimal } from '../logic/numbers';

export type SetValues = Pick<SetLog, 'weight_kg' | 'reps' | 'seconds'>;
type Patch = Partial<SetValues & Pick<SetLog, 'done'>>;
type Field = keyof SetValues;

const sideName = (side: Row['side']) => (side === 'H' ? 'Højre' : side === 'V' ? 'Venstre' : '');

export function describeSet(v: SetValues, kind: ExerciseKind) {
  if (kind === 'time') return v.seconds != null ? `${v.seconds} sek` : '–';
  const reps = v.reps != null ? `${v.reps} reps` : '–';
  return kind === 'weight_reps' && v.weight_kg != null ? `${formatDecimal(v.weight_kg)} kg × ${v.reps ?? '–'}` : reps;
}

/** Felterne en øvelse logger: kg og reps, kun reps, eller sekunder. */
export const fieldsOf = (kind: ExerciseKind): Field[] => (kind === 'time' ? ['seconds'] : kind === 'weight_reps' ? ['weight_kg', 'reps'] : ['reps']);

/** Kolonnerne i sættabellen: sæt, sidst, felterne og ✓. */
export const gridOf = (kind: ExerciseKind) => (fieldsOf(kind).length === 2 ? 'grid-cols-[2.75rem_minmax(0,1fr)_4.25rem_4.25rem_2.75rem]' : 'grid-cols-[2.75rem_minmax(0,1fr)_5.5rem_2.75rem]');

const text = (v: number | null) => (v == null ? '' : formatDecimal(v));

/** "12,5" eller "12.5" → 12.5. Tomt eller ugyldigt → null. Reps og sekunder er hele tal. */
function parse(s: string, field: Field): number | null {
  const n = Number(s.trim().replace(',', '.'));
  if (!s.trim() || !Number.isFinite(n) || n < 0) return null;
  return field === 'weight_kg' ? Math.round(n * 100) / 100 : Math.round(n);
}

/** Det felterne foreslår (gråt): sidste gang, ellers planens mål. */
function suggested(ghost: Ghost | undefined, row: Row): SetValues {
  return {
    weight_kg: ghost?.weight_kg ?? null,
    reps: ghost?.reps ?? row.reps?.max ?? null,
    seconds: ghost?.seconds ?? row.seconds?.max ?? null,
  };
}

/**
 * Ét sæt som en række i tabellen: sætnummer, hvad sættet var sidst, felter og ✓. Felterne er
 * tomme med sidste gangs tal (ellers målet) i gråt, så et sæt magen til sidst er ét tryk på ✓
 * uden tastatur. Et færdigt sæt får grøn baggrund.
 */
export function SetRow({ row, kind, log, ghost, previous, onPatch, onDone }: {
  row: Row;
  kind: ExerciseKind;
  log: SetLog | undefined;
  ghost: Ghost | undefined;
  /** Sættet sidste gang, fx "50 kg × 8". */
  previous?: string;
  onPatch: (p: Patch) => void;
  /** ✓: gemmer tallene (de skrevne, ellers de foreslåede) sammen med done. */
  onDone: (done: boolean, values: SetValues) => void;
}) {
  const fields = fieldsOf(kind);
  const [input, setInput] = useState(() => ({ weight_kg: text(log?.weight_kg ?? null), reps: text(log?.reps ?? null), seconds: text(log?.seconds ?? null) }));
  // Optimistisk ✓, så to hurtige tryk ikke læser en forældet værdi.
  const [done, setDone] = useState(!!log?.done);
  useEffect(() => setDone(!!log?.done), [log?.done]);
  // Nyt fra databasen (fx "Samme som sidst" eller sync).
  useEffect(
    () => setInput({ weight_kg: text(log?.weight_kg ?? null), reps: text(log?.reps ?? null), seconds: text(log?.seconds ?? null) }),
    [log?.weight_kg, log?.reps, log?.seconds],
  );

  const hint = suggested(ghost, row);
  const name = `Sæt ${row.setNo}${row.side ? ` ${sideName(row.side).toLowerCase()}` : ''}`;
  const unit: Record<Field, string> = { weight_kg: 'kg', reps: 'reps', seconds: 'sekunder' };

  const commit = (field: Field) => {
    const value = parse(input[field], field);
    if (value !== (log?.[field] ?? null)) onPatch({ [field]: value });
    setInput((i) => ({ ...i, [field]: text(value) }));
  };

  const toggle = () => {
    const pick = (f: Field) => parse(input[f], f) ?? (log?.[f] ?? hint[f]);
    const values: SetValues = { weight_kg: pick('weight_kg'), reps: pick('reps'), seconds: pick('seconds') };
    setDone(!done);
    onDone(!done, values);
  };

  const dim = row.optional && !log;
  return (
    <li className={`grid ${gridOf(kind)} items-center gap-x-2 px-3 py-1.5 transition-colors duration-200 ease-ios ${done ? 'bg-status-green/15' : ''}`}>
      <span className={`flex flex-col items-center justify-center leading-none ${dim ? 'opacity-60' : ''}`}>
        <span className={`num grid h-8 min-w-8 place-items-center rounded-lg px-1 text-headline ${done ? '' : 'bg-fill'}`}>
          {row.setNo}
          {row.side && <span className="text-caption text-ink-2">{row.side}</span>}
        </span>
        {(row.optional || row.extra) && <span className="mt-0.5 text-[10px] leading-3 text-ink-2">{row.extra ? 'ekstra' : 'valgfri'}</span>}
      </span>
      <span className="num truncate text-secondary text-ink-3" title={previous}>
        {previous ?? '–'}
      </span>
      {fields.map((f) => (
        <input
          key={f}
          type="text"
          inputMode={f === 'weight_kg' ? 'decimal' : 'numeric'}
          enterKeyHint="done"
          autoComplete="off"
          aria-label={`${name}, ${unit[f]}`}
          placeholder={text(hint[f]) || '–'}
          value={input[f]}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setInput((i) => ({ ...i, [f]: e.target.value }))}
          onBlur={() => commit(f)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className={`num h-10 w-full min-w-0 rounded-[10px] text-center text-row placeholder:text-ink-3 ${done ? 'bg-transparent' : 'bg-fill'}`}
        />
      ))}
      <button
        type="button"
        aria-pressed={done}
        aria-label={`${name} færdigt`}
        onClick={toggle}
        className={`grid size-10 place-items-center justify-self-end rounded-[10px] transition-colors duration-200 ease-ios ${done ? 'animate-pop bg-status-green text-on-brand' : 'bg-fill text-ink-3'}`}
      >
        <Check size={20} weight="bold" aria-hidden="true" />
      </button>
    </li>
  );
}
