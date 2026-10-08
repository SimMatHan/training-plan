import { useEffect, useState } from 'react';
import { Link, useLocation, useRoute, useSearch } from 'wouter';
import type { Proposal, ProposalKind, ProposalStatus } from '../../shared/proposals';
import { Screen, Section } from '../components/Screen';
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
  afventer: { label: 'Venter på dig', className: 'text-b-ink' },
  godkendt: { label: 'Godkendt', className: 'text-mob-ink' },
  afvist: { label: 'Afvist', className: 'text-muted' },
  forældet: { label: 'Forældet', className: 'text-muted' },
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
    <Screen title="Forslag fra Claude" eyebrow={<Link href={who.readOnly ? `/forslag${who.query}` : '/'}>{who.readOnly ? '← Forslag' : '← I dag'}</Link>}>
      {who.readOnly && <ReadOnlyNote name={who.name} />}
      {error && (
        <p role="alert" className="mb-4 text-a-ink">
          {error}
        </p>
      )}
      {!proposal && !error && <p className="text-muted">Henter …</p>}
      {proposal && (
        <>
          <p className={`mb-1 text-sm font-semibold ${STATUS[proposal.status].className}`}>
            {STATUS[proposal.status].label}
            <span className="font-normal text-muted">
              {' '}
              · {KIND[proposal.kind]} · {formatWithYear(proposal.createdAt)}
              {proposal.baseVersion > 0 && proposal.kind === 'patch' && ` · mod version ${proposal.baseVersion}`}
              {proposal.resultVersion && ` · blev version ${proposal.resultVersion}`}
            </span>
          </p>
          <h2 className="mb-5 text-2xl">{proposal.summary}</h2>

          <Section title="Ændringer">
            <ul className="divide-y divide-line border-y border-line">
              {proposal.diff.map((line, i) => (
                <li key={i} className="num py-2.5">
                  {line}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Hvorfor">
            <p className="whitespace-pre-line">{proposal.rationale}</p>
          </Section>

          {proposal.status === 'afventer' && who.readOnly && <p className="text-sm text-muted">Venter på, at {who.name} godkender eller afviser.</p>}
          {proposal.status === 'afventer' && !who.readOnly && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void decide('reject')}
                disabled={busy !== undefined}
                className="min-h-14 flex-1 rounded-lg border border-line font-medium disabled:opacity-40"
              >
                {busy === 'reject' ? 'Afviser …' : 'Afvis'}
              </button>
              <button
                type="button"
                onClick={() => void decide('approve')}
                disabled={busy !== undefined}
                className="min-h-14 flex-1 rounded-lg bg-fg text-lg font-semibold text-bg disabled:opacity-40"
              >
                {busy === 'approve' ? 'Godkender …' : 'Godkend'}
              </button>
            </div>
          )}
          {proposal.status === 'forældet' && (
            <p className="text-sm text-muted">Planen er ændret, siden forslaget blev lavet. Bed Claude om et nyt forslag mod den aktive plan.</p>
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
    <Screen title="Forslag fra Claude" eyebrow={<Link href={who.readOnly ? `/uge${who.query}` : '/'}>{who.readOnly ? '← Uge' : '← I dag'}</Link>}>
      {who.readOnly && <ReadOnlyNote name={who.name} />}
      {error && (
        <p role="alert" className="mb-4 text-a-ink">
          {error}
        </p>
      )}
      {list && list.length === 0 && <p className="text-muted">Ingen forslag endnu.</p>}
      {list && list.length > 0 && (
        <ul className="divide-y divide-line border-y border-line">
          {list.map((p) => (
            <li key={p.id}>
              <Link href={`/forslag/${p.id}${who.query}`} className="flex min-h-16 items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{p.summary}</span>
                  <span className="block text-sm text-muted">
                    <span className={STATUS[p.status].className}>{who.readOnly && p.status === 'afventer' ? 'Venter' : STATUS[p.status].label}</span> · {KIND[p.kind]} ·{' '}
                    {formatWithYear(p.createdAt)}
                  </span>
                </span>
                <span aria-hidden="true" className="text-xl text-muted">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

/** Trænervisning: tydeligt markeret med atletens navn og skrivebeskyttet. */
export function ReadOnlyNote({ name }: { name: string }) {
  return (
    <p className="mb-5 rounded-lg border-2 border-b px-3 py-2 text-sm font-medium">
      Trænervisning · {name} · skrivebeskyttet
    </p>
  );
}
