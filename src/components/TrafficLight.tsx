import type { PainLight } from '../../shared/pain';

const dot: Record<PainLight, string> = {
  grøn: 'bg-mob',
  gul: 'bg-run',
  rød: 'bg-a',
  afventer: 'border-2 border-muted',
  ukendt: 'border-2 border-dashed border-muted',
};

const text: Record<PainLight, string> = {
  grøn: 'Grøn',
  gul: 'Gul',
  rød: 'Rød',
  afventer: 'Afventer morgen',
  ukendt: 'Uden morgenscore',
};

/** Trafiklys med farve OG tekst — farven står aldrig alene. `label` er monitoren, fx "Venstre lyske". */
export function TrafficLight({ light, compact = false, label = 'Smerte' }: { light: PainLight; compact?: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" title={`${label}: ${text[light]}`}>
      <span aria-hidden="true" className={`inline-block size-3 shrink-0 rounded-full ${dot[light]}`} />
      <span className={compact ? 'sr-only' : ''}>{compact ? `${label}: ${text[light]}` : text[light]}</span>
    </span>
  );
}
