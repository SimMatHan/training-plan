import type { Session } from '../../shared/plan.schema';

const bg: Record<Session['colorKey'], string> = {
  A: 'bg-a',
  B: 'bg-b',
  run: 'bg-run',
  mobility: 'bg-mob',
};

/** Lodret farvestreg der viser sessionstypen (A rød, B blå, løb gul, mobilitet grøn). */
export function SessionMark({ colorKey, className = '' }: { colorKey: Session['colorKey']; className?: string }) {
  return <span aria-hidden="true" className={`inline-block w-1.5 shrink-0 rounded-full ${bg[colorKey]} ${className}`} />;
}
