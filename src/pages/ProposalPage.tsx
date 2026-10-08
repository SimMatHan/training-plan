import { useEffect, useState } from 'react';
import { useLocation, useRoute, useSearch } from 'wouter';
import type { Proposal, ProposalKind, ProposalStatus } from '../../shared/proposals';
import { PrimaryButton, SecondaryButton } from '../ui/Button';
import { Card, Group, InsetList, InsetRow, RowText } from '../ui/InsetList';
import { ErrorText, Muted, Screen } from '../ui/Screen';
import { usePlan } from '../data/plan';
import { decideProposal, fetchProposal, fetchProposals } from '../data/proposals';
import { OfflineError } from '../lib/api';
import { useMe } from '../lib/auth';
import { formatWithYear } from '../lib/dates';

const KIND: Record<ProposalKind, string> = { patch: 'Ændring af planen', 'ny-plan': 'Ny plan', overvaagning: 'Overvågning' };

/** Atleten forslagene hører til: ?atlet=<slug> (træner), ellers egen. */
function useProposalAthlete() {
  const me = useMe();
  const { slug: own } = usePlan();
  const wanted = new URLSearchParams(useSearch()).get('atlet');
  const athlete = me.athletes.find((a) => a.slug === wanted) ?? me.athletes.find((a) => a.slug === own)!;
  return { slug: athlete.slug, name: athlete.name, readOnly: athlete.role !== 'ejer', query: athlete.slug === own ? '' : `?atlet=${athlete.slug}` };
}

const STATUS: Record<ProposalStatus, { label: string; className: string }> = {
  afventer: { label: 'Venter på dig', className: 'text-ink' },
  godkendt: { label: 'Godkendt', className: 'text-ink' },
  afvist: { label: 'Afvist', className: 'text-ink-2' },
  forældet: { label: 'Forældet', className: 'text-ink-2' },
};

const errorText = (e: unknown) => (e instanceof OfflineError ? 'Ingen forbindelse. Forslag kan kun ses og godkendes med net.' : (e as Error).message);

/** Ét forslag: summary, begrundelse og en læsbar diff. Godkend laver en ny planversion. */
export function ProposalPage() {
  const [, params] = useRoute('/forslag/:id');
  const id = params?.id ?? '';
  const [, navigate] = useLocation();
  const { refresh } = usePlan();
  const who = useProposalAthlete();
  const [proposal, setProposal] = useState<Proposal>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'approve' | 'reject'>();

  useEffect(() => {
    fetchProposal(who.slug, id).then(setProposal, (e) => setError(errorText(e)));
  }, [who.slug, id]);

  async function decide(decision: 'approve' | 'reject') {
    const question =
      decision === 'reject'
        ? 'Afvis forslaget? Intet ændres.'
        : proposal?.kind === 'overvaagning'
          ? 'Godkend forslaget? Overvågningen ændres med det samme.'
          : 'Godkend forslaget? Det bliver en ny planversion, som er aktiv med det samme. Kalenderen følger med, og du kan rulle tilbage under Indstillinger → Plan.';
    if (!confirm(question)) return;
    setBusy(decision);
    setError(undefined);
    try {
      const updated = await decideProposal(who.slug, id, decision);
      setProposal(updated);
      if (decision === 'approve') {
        await refresh();
        navigate('/');
      }
    } catch (e) {
      setError(errorText(e));
      // Fx forældet: vis den aktuelle status.
      fetchProposal(who.slug, id).then(setProposal, () => undefined);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Screen title="Forslag fra Claude" back={who.readOnly ? { href: `/forslag${who.query}`, label: 'Forslag' } : { href: '/', label: 'I dag' }}>
      {who.readOnly && <ReadOnlyNote name={who.name} />}
      <ErrorText className="mb-4">{error}</ErrorText>
      {!proposal && !error && <Muted>Henter …</Muted>}
      {proposal && (
        <>
          <p className={`mb-1 px-1 text-footnote font-semibold ${STATUS[proposal.status].className}`}>
            {STATUS[proposal.status].label}
            <span className="font-normal text-ink-2">
              {' '}
              · {KIND[proposal.kind]} · {formatWithYear(proposal.createdAt)}
              {proposal.baseVersion > 0 && proposal.kind === 'patch' && ` · mod version ${proposal.baseVersion}`}
              {proposal.resultVersion && ` · blev version ${proposal.resultVersion}`}
            </span>
          </p>
          <h2 className="mb-6 px-1 text-title">{proposal.summary}</h2>

          <Group title="Ændringer">
            <ul className="inset-list overflow-hidden rounded-card bg-surface">
              {proposal.diff.map((line, i) => (
                <li key={i} className="num px-4 py-3 text-secondary">
                  {line}
                </li>
              ))}
            </ul>
          </Group>

          <Group title="Hvorfor">
            <Card className="whitespace-pre-line text-body">{proposal.rationale}</Card>
          </Group>

          {proposal.status === 'afventer' && who.readOnly && <Muted className="px-1">Venter på, at {who.name} godkender eller afviser.</Muted>}
          {proposal.status === 'afventer' && !who.readOnly && (
            <div className="flex gap-2">
              <SecondaryButton onClick={() => void decide('reject')} disabled={busy !== undefined}>
                {busy === 'reject' ? 'Afviser …' : 'Afvis'}
              </SecondaryButton>
              <PrimaryButton onClick={() => void decide('approve')} disabled={busy !== undefined}>
                {busy === 'approve' ? 'Godkender …' : 'Godkend'}
              </PrimaryButton>
            </div>
          )}
          {proposal.status === 'forældet' && (
            <p className="px-1 text-secondary text-ink-2">Planen er ændret, siden forslaget blev lavet. Bed Claude om et nyt forslag mod den aktive plan.</p>
          )}
        </>
      )}
    </Screen>
  );
}

/** Alle forslag, nyeste først. */
export function ProposalsPage() {
  const who = useProposalAthlete();
  const [list, setList] = useState<Proposal[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetchProposals(who.slug).then(setList, (e) => setError(errorText(e)));
  }, [who.slug]);

  return (
    <Screen title="Forslag fra Claude" back={who.readOnly ? { href: `/uge${who.query}`, label: 'Uge' } : { href: '/', label: 'I dag' }}>
      {who.readOnly && <ReadOnlyNote name={who.name} />}
      <ErrorText className="mb-4">{error}</ErrorText>
      {list && list.length === 0 && <Muted>Ingen forslag endnu.</Muted>}
      {list && list.length > 0 && (
        <InsetList>
          {list.map((p) => (
            <InsetRow key={p.id} href={`/forslag/${p.id}${who.query}`}>
              <RowText
                title={p.summary}
                detail={
                  <>
                    <span className={STATUS[p.status].className}>{who.readOnly && p.status === 'afventer' ? 'Venter' : STATUS[p.status].label}</span> · {KIND[p.kind]} ·{' '}
                    {formatWithYear(p.createdAt)}
                  </>
                }
              />
            </InsetRow>
          ))}
        </InsetList>
      )}
    </Screen>
  );
}

/** Trænervisning: tydeligt markeret med atletens navn og skrivebeskyttet. */
export function ReadOnlyNote({ name }: { name: string }) {
  return (
    <p className="mb-5 rounded-card bg-surface px-4 py-3 text-secondary font-medium ring-1 ring-separator ring-inset">
      Trænervisning · {name} · skrivebeskyttet
    </p>
  );
}
