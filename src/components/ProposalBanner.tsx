import { Link } from 'wouter';
import { usePendingProposals } from '../data/proposals';

/** På I dag, når Claude har foreslået en ændring til planen, der venter på godkendelse. */
export function ProposalBanner() {
  const pending = usePendingProposals();
  if (!pending.length) return null;
  const one = pending.length === 1;

  return (
    <Link href={one ? `/forslag/${pending[0].id}` : '/forslag'} className="mb-7 flex min-h-14 items-center gap-3 rounded-lg border-2 border-b p-4">
      <span aria-hidden="true" className="inline-block h-10 w-1.5 shrink-0 rounded-full bg-b" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{one ? 'Claude foreslår en ændring til planen' : `Claude foreslår ${pending.length} ændringer til planen`}</span>
        <span className="block text-sm text-muted">{one ? pending[0].summary : 'Se forslagene og godkend eller afvis'}</span>
      </span>
      <span aria-hidden="true" className="text-xl text-muted">
        ›
      </span>
    </Link>
  );
}
