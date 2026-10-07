import type { GroinLight } from '../../shared/groin';

const dot: Record<GroinLight, string> = {
  grøn: 'bg-mob',
  gul: 'bg-run',
  rød: 'bg-a',
  afventer: 'border-2 border-muted',
  ukendt: 'border-2 border-dashed border-muted',
};

const text: Record<GroinLight, string> = {
  grøn: 'Grøn',
  gul: 'Gul',
  rød: 'Rød',
  afventer: 'Afventer morgen',
  ukendt: 'Uden morgenscore',
};

/** Trafiklys med farve OG tekst — farven står aldrig alene. */
export function TrafficLight({ light, compact = false }: { light: GroinLight; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" title={`Lyske: ${text[light]}`}>
      <span aria-hidden="true" className={`inline-block size-3 shrink-0 rounded-full ${dot[light]}`} />
      <span className={compact ? 'sr-only' : ''}>
        {compact ? `Lyske: ${text[light]}` : text[light]}
      </span>
    </span>
  );
}
