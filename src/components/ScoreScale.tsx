/** Skala 0–10 til lyskesmerte. 11 knapper i to rækker, så hver er mindst 48 px. */
export function ScoreScale({ value, onChange, label, hint }: { value: number | null; onChange: (v: number) => void; label: string; hint?: string }) {
  return (
    <fieldset>
      <legend className="mb-1 font-medium">{label}</legend>
      {hint && <p className="mb-2 text-sm text-muted">{hint}</p>}
      <div className="grid grid-cols-6 gap-1.5">
        {Array.from({ length: 11 }, (_, v) => {
          const selected = value === v;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(v)}
              className={`num min-h-12 rounded-md text-xl ${selected ? 'bg-fg font-bold text-bg' : 'border border-line'}`}
            >
              {v}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>0 = intet</span>
        <span>10 = værst</span>
      </div>
    </fieldset>
  );
}
