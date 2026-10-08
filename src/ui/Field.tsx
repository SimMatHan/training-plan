import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

/** Fælles udseende for felter: --surface-2, radius 10, 44 px. */
export const fieldClass = 'num min-h-11 w-full min-w-0 rounded-[10px] bg-surface-2 px-3 text-body text-ink disabled:opacity-50';

export function TextField({ label, hint, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode }) {
  const id = useId();
  const input = <input id={id} className={`${fieldClass} ${className}`} {...rest} />;
  if (!label) return input;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-footnote text-ink-2">
        {label}
      </label>
      {input}
      {hint && <p className="text-footnote text-ink-2">{hint}</p>}
    </div>
  );
}

export function TextArea({ label, className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-footnote text-ink-2">
        {label}
      </label>
      <textarea id={id} rows={2} className={`${fieldClass} py-2.5 ${className}`} {...rest} />
    </div>
  );
}

export function Select({ label, className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-footnote text-ink-2">
        {label}
      </label>
      <select id={id} className={`${fieldClass} ${className}`} {...rest}>
        {children}
      </select>
    </div>
  );
}

/** iOS-kontakt (role="switch"). Tændt = --brand-red. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-body">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ease-ios ${checked ? 'bg-brand-red' : 'bg-surface-2 ring-1 ring-separator ring-inset'}`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-[2px] left-[2px] size-[27px] rounded-full bg-surface shadow-pill transition-transform duration-200 ease-ios ${checked ? 'translate-x-5' : ''}`}
        />
      </button>
    </label>
  );
}

/** Rækker af valg (RPE, skala, årsager): små piller, den valgte i --ink. */
export function ChoiceGrid<T extends string | number>({
  options,
  value,
  onChange,
  label,
  columns,
  format = String,
}: {
  options: readonly T[];
  value: T | null;
  onChange: (v: T) => void;
  label: ReactNode;
  columns: number;
  format?: (v: T) => string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-footnote text-ink-2">{label}</legend>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {options.map((o) => {
          const selected = o === value;
          return (
            <button
              key={String(o)}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(o)}
              className={`num min-h-11 rounded-[10px] px-1 text-body transition-colors duration-150 ${selected ? 'bg-ink font-semibold text-surface' : 'bg-surface-2 text-ink'}`}
            >
              {format(o)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
