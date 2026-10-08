/** iOS-segmenteret kontrol på --surface-2; det valgte segment er en hvid pille med svag skygge. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className = '',
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`flex gap-0.5 rounded-[11px] bg-surface-2 p-0.5 ${className}`}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            className={`min-h-10 flex-1 rounded-[9px] px-3 text-secondary font-semibold whitespace-nowrap transition-[background-color,box-shadow] duration-200 ease-ios ${
              selected ? 'bg-surface text-ink shadow-pill' : 'text-ink-2'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
