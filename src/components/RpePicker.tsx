import { formatDecimal } from '../logic/numbers';
import { ChoiceGrid } from '../ui/Field';

const VALUES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

/** RPE 6–10 i halve trin. Tryk på det valgte tal for at fjerne det. */
export function RpePicker({ value, onChange, label, target }: { value: number | null; onChange: (v: number | null) => void; label: string; target?: string }) {
  return (
    <ChoiceGrid
      label={target ? `${label} · mål ${target}` : label}
      columns={5}
      options={VALUES}
      value={value}
      format={formatDecimal}
      onChange={(v) => onChange(v === value ? null : v)}
    />
  );
}
