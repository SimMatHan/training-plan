import { ChoiceGrid } from '../ui/Field';

const VALUES = Array.from({ length: 11 }, (_, i) => i);

/** Skala 0–10 til smerte. 11 knapper i to rækker, så hver er mindst 44 px. */
export function ScoreScale({ value, onChange, label, hint }: { value: number | null; onChange: (v: number) => void; label: string; hint?: string }) {
  return (
    <div>
      <ChoiceGrid label={<span className="text-headline text-ink">{label}</span>} columns={6} options={VALUES} value={value} onChange={onChange} />
      <div className="mt-1 flex justify-between text-footnote text-ink-2">
        <span>0 = intet</span>
        <span>10 = værst</span>
      </div>
      {hint && <p className="mt-1 text-footnote text-ink-2">{hint}</p>}
    </div>
  );
}
