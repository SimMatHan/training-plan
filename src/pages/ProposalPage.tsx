import { useEffect, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import type { Proposal, ProposalStatus } from '../../shared/proposals';
import { Screen, Section } from '../components/Screen';
import { usePlan } from '../data/plan';
import { decideProposal, fetchProposal, fetchProposals } from '../data/proposals';
import { OfflineError } from '../lib/api';
import { formatWithYear } from '../lib/dates';

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
  const [proposal, setProposal] = useState<Proposal>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'approve' | 'reject'>();

  useEffect(() => {
    fetchProposal(id).then(setProposal, (e) => setError(errorText(e)));
  }, [id]);

  async function decide(decision: 'approve' | 'reject') {
    const question =
      decision === 'approve'
        ? 'Godkend forslaget? Det bliver en ny planversion, som er aktiv med det samme. Kalenderen følger med, og du kan rulle tilbage under Indstillinger → Plan.'
        : 'Afvis forslaget? Planen ændres ikke.';
    if (!confirm(question)) return;
    setBusy(decision);
    setError(undefined);
    try {
      const updated = await decideProposal(id, decision);
      setProposal(updated);
      if (decision === 'approve') {
        await refresh();
        navigate('/');
      }
    } catch (e) {
      setError(errorText(e));
      // Fx forældet: vis den aktuelle status.
      fetchProposal(id).then(setProposal, () => undefined);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Screen title="Forslag fra Claude" eyebrow={<Link href="/">← I dag</Link>}>
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
              · {formatWithYear(proposal.createdAt)} · mod version {proposal.baseVersion}
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

          {proposal.status === 'afventer' && (
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
  const [list, setList] = useState<Proposal[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetchProposals().then(setList, (e) => setError(errorText(e)));
  }, []);

  return (
    <Screen title="Forslag fra Claude" eyebrow={<Link href="/">← I dag</Link>}>
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
              <Link href={`/forslag/${p.id}`} className="flex min-h-16 items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{p.summary}</span>
                  <span className="block text-sm text-muted">
                    <span className={STATUS[p.status].className}>{STATUS[p.status].label}</span> · {formatWithYear(p.createdAt)}
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
