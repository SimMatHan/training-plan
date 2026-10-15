import { Minus, Plus } from '@phosphor-icons/react';
import type { Dose, Exercise, NumRange } from '../../shared/plan.schema';
import { formatNumber, formatRange } from '../../shared/resolve';
import { InsetList } from '../ui/InsetList';
import { Switch, TextArea, TextField } from '../ui/Field';

/** − tal + uden tastatur, som en række i en InsetList. */
export function Stepper({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  max = 999,
  format = formatNumber,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
  const button = 'grid size-11 shrink-0 place-items-center rounded-full bg-fill text-ink disabled:opacity-30';
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2">
      <span className="min-w-0 flex-1 text-row">{label}</span>
      <button type="button" className={button} onClick={() => set(value - step)} disabled={value <= min} aria-label={`${label}: færre`}>
        <Minus size={18} weight="bold" aria-hidden="true" />
      </button>
      <output aria-live="polite" aria-label={label} className="num w-16 text-center text-row font-semibold">
        {format(value)}
      </output>
      <button type="button" className={button} onClick={() => set(value + step)} disabled={value >= max} aria-label={`${label}: flere`}>
        <Plus size={18} weight="bold" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Et tal eller et interval ("8" eller "8–12"): stepper for laveste og, med kontakten, for højeste. */
function RangeRows({
  label,
  value,
  onChange,
  step,
  min,
  max,
  unit = '',
  example,
}: {
  label: string;
  value: NumRange;
  onChange: (r: NumRange) => void;
  step: number;
  min: number;
  max: number;
  unit?: string;
  /** Eksempel i kontaktens tekst, fx "8–12". */
  example: string;
}) {
  const range = value.max !== value.min;
  const fmt = (v: number) => `${formatNumber(v)}${unit}`;
  return (
    <>
      <Stepper label={range ? `${label}, fra` : label} value={value.min} step={step} min={min} max={max} format={fmt} onChange={(v) => onChange({ min: v, max: range ? Math.max(v, value.max) : v })} />
      {range && <Stepper label={`${label}, til`} value={value.max} step={step} min={value.min} max={max} format={fmt} onChange={(v) => onChange({ min: value.min, max: v })} />}
      <li className="px-4 py-1">
        <Switch label={`Interval (fx ${example})`} checked={range} onChange={(on) => onChange(on ? { min: value.min, max: Math.min(max, value.min + step * 2) } : { min: value.min, max: value.min })} />
      </li>
    </>
  );
}

/**
 * Doseringen af én øvelse: sæt, reps eller sekunder, RPE, pause, tempo, note og udførelse.
 * Afvigende dosis pr. side og %1RM rettes ikke her, men bevares.
 */
export function DoseEditor({
  exercise,
  dose,
  onChange,
  cue,
  onCue,
}: {
  exercise: Exercise;
  dose: Dose;
  onChange: (d: Dose) => void;
  cue: string | undefined;
  onCue: (c: string | undefined) => void;
}) {
  const set = (patch: Partial<Dose>) => onChange({ ...dose, ...patch });
  const timed = exercise.kind === 'time';
  const intensity = dose.intensity;
  const text = (v: string) => (v.trim() ? v : undefined);
  return (
    <div className="flex flex-col gap-4">
      <InsetList label="Sæt">
        <Stepper label="Sæt" value={dose.sets} min={1} max={12} onChange={(sets) => set({ sets })} />
        <Stepper label="Valgfrie ekstra sæt" value={dose.optionalSets ?? 0} min={0} max={5} onChange={(optionalSets) => set({ optionalSets })} />
      </InsetList>

      <InsetList label={timed ? 'Sekunder' : 'Reps'}>
        {timed ? (
          <RangeRows label="Sekunder" unit=" s" value={dose.seconds ?? { min: 30, max: 30 }} example="30–45 s" step={5} min={5} max={600} onChange={(seconds) => set({ seconds })} />
        ) : (
          <RangeRows label={exercise.perSide ? 'Reps pr. side' : 'Reps'} value={dose.reps ?? { min: 8, max: 8 }} example="8–12" step={1} min={1} max={100} onChange={(reps) => set({ reps })} />
        )}
      </InsetList>
      {dose.sideOverrides && Object.keys(dose.sideOverrides).length > 0 && (
        <p className="-mt-2 px-4 text-footnote text-ink-2">Planen har en afvigende dosis for én side. Den bevares.</p>
      )}

      <InsetList label="Intensitet og pause">
        {intensity?.kind === 'pct1rm' ? (
          <li className="flex min-h-14 items-center px-4 text-row">
            Intensitet <span className="num ml-auto text-ink-2">{formatRange(intensity)} % 1RM</span>
          </li>
        ) : (
          <>
            <li className="px-4 py-1">
              <Switch label="RPE-mål" checked={!!intensity} onChange={(on) => set({ intensity: on ? { kind: 'rpe', min: 7, max: 7 } : undefined })} />
            </li>
            {intensity?.kind === 'rpe' && (
              <RangeRows label="RPE" value={intensity} example="7–8" step={0.5} min={1} max={10} onChange={(r) => set({ intensity: { kind: 'rpe', ...r } })} />
            )}
          </>
        )}
        <Stepper label="Pause" value={dose.restSec} step={15} min={0} max={600} format={(v) => `${v} s`} onChange={(restSec) => set({ restSec })} />
      </InsetList>

      <div className="flex flex-col gap-3 px-1">
        <TextField label="Tempo eller krav (valgfrit)" placeholder="fx 3 sek ned" value={dose.tempo ?? ''} onChange={(e) => set({ tempo: text(e.target.value) })} />
        <TextField label="Note til doseringen (valgfri)" placeholder="fx Halv kraft" value={dose.note ?? ''} onChange={(e) => set({ note: text(e.target.value) })} />
        <TextArea label="Udførelse (valgfri)" value={cue ?? ''} onChange={(e) => onCue(text(e.target.value))} />
      </div>
    </div>
  );
}
