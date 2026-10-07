import { formatDecimal } from '../logic/numbers';

const VALUES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

/** RPE 6–10 i halve trin. Tryk på det valgte tal for at fjerne det. */
export function RpePicker({ value, onChange, label, target }: { value: number | null; onChange: (v: number | null) => void; label: string; target?: string }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm text-muted">
        {label}
        {target && <span className="num"> · mål {target}</span>}
      </legend>
      <div className="grid grid-cols-5 gap-1.5">
        {VALUES.map((v) => {
          const selected = value === v;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(selected ? null : v)}
              className={`num min-h-12 rounded-md text-base ${selected ? 'bg-fg font-bold text-bg' : 'border border-line'}`}
            >
              {formatDecimal(v)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
