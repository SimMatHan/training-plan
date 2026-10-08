import { Sparkle } from '@phosphor-icons/react';
import { usePendingProposals } from '../data/proposals';
import { InsetList, InsetRow, RowText } from '../ui/InsetList';

/** På I dag, når Claude har foreslået en ændring til planen, der venter på godkendelse. */
export function ProposalBanner() {
  const pending = usePendingProposals();
  if (!pending.length) return null;
  const one = pending.length === 1;

  return (
    <InsetList className="mb-8">
      <InsetRow href={one ? `/forslag/${pending[0].id}` : '/forslag'}>
        <span className="grid size-9 shrink-0 place-items-center rounded-tile bg-surface-2 text-cat-arms" aria-hidden="true">
          <Sparkle size={20} weight="fill" />
        </span>
        <RowText
          title={one ? 'Claude foreslår en ændring til planen' : `Claude foreslår ${pending.length} ændringer til planen`}
          detail={one ? pending[0].summary : 'Se forslagene og godkend eller afvis'}
        />
      </InsetRow>
    </InsetList>
  );
}
