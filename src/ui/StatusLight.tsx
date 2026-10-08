import type { PainLight } from '../../shared/pain';

const DOT: Record<PainLight, string> = {
  grøn: 'bg-status-green',
  gul: 'bg-status-yellow',
  rød: 'bg-status-red',
  afventer: 'border-2 border-ink-3',
  ukendt: 'border-2 border-dashed border-ink-3',
};

export const LIGHT_TEXT: Record<PainLight, string> = {
  grøn: 'Grøn',
  gul: 'Gul',
  rød: 'Rød',
  afventer: 'Afventer morgen',
  ukendt: 'Uden morgenscore',
};

/** Trafiklys: lille prik + tekst. Farven står aldrig alene; brand-gradienten bruges aldrig her. */
export function StatusLight({ light, compact = false, label = 'Smerte' }: { light: PainLight; compact?: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-secondary text-ink" title={`${label}: ${LIGHT_TEXT[light]}`}>
      <StatusDot light={light} />
      <span className={compact ? 'sr-only' : ''}>{compact ? `${label}: ${LIGHT_TEXT[light]}` : LIGHT_TEXT[light]}</span>
    </span>
  );
}

export function StatusDot({ light }: { light: PainLight }) {
  return <span aria-hidden="true" className={`inline-block size-2.5 shrink-0 rounded-full ${DOT[light]}`} />;
}
