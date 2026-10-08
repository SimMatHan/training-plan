import { useEffect, useState } from 'react';
import type { McpAuditEntry } from '../../shared/proposals';
import { usePlan } from '../data/plan';
import { athleteApi, OfflineError } from '../lib/api';
import { useMe } from '../lib/auth';
import { ButtonLink, smallButton } from '../ui/Button';
import { Group } from '../ui/InsetList';
import { ErrorText, Muted } from '../ui/Screen';

const TIME = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const ERRORS: Record<NonNullable<McpAuditEntry['error']>, string> = {
  'ugyldigt-input': 'ugyldigt input',
  'ikke-fundet': 'ikke fundet',
  konflikt: 'konflikt',
  'ingen-adgang': 'ingen adgang',
  serverfejl: 'serverfejl',
};

/**
 * Indstillinger → Claude: én connector-adresse pr. atlet (egen og dem man er træner for),
 * forslag og de seneste 20 MCP-kald på egen træning.
 */
export function ClaudeSection() {
  const me = useMe();
  const { slug } = usePlan();
  const [audit, setAudit] = useState<McpAuditEntry[]>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState<string>();

  useEffect(() => {
    athleteApi<McpAuditEntry[]>(slug, '/mcp/audit').then(setAudit, (e: Error) => setError(e instanceof OfflineError ? 'Offline — loggen vises, når der er net.' : e.message));
  }, [slug]);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(undefined), 2000);
    } catch {
      setError('Kunne ikke kopiere. Markér adressen og kopiér den manuelt.');
    }
  }

  return (
    <Group title="Claude">
      <Muted className="mb-3 px-1">
        Én forbindelse pr. atlet, så Claude aldrig blander jeres data. Tilføj adressen i claude.ai (Indstillinger → Connectors → Tilføj brugerdefineret
        connector, i en browser) og log ind med din passkey, når claude.ai beder om det.
      </Muted>
      <ul className="mb-4 flex flex-col gap-3">
        {me.athletes.map((a) => {
          const url = `${location.origin}/mcp/${a.slug}`;
          return (
            <li key={a.slug}>
              <p className="mb-1.5 px-1 text-footnote text-ink-2">
                Træningsnav – {a.name}
                {a.role === 'traener' && <span> (du er træner)</span>}
              </p>
              <div className="flex gap-2">
                <p className="num min-w-0 flex-1 rounded-card bg-surface p-3 text-secondary break-all select-all">{url}</p>
                <button type="button" onClick={() => void copy(url)} className={smallButton('secondary', 'shrink-0 self-center')}>
                  {copied === url ? 'Kopieret ✓' : 'Kopiér'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <ButtonLink href="/forslag" className="mb-6">
        Alle forslag
      </ButtonLink>
      <h3 className="mb-1.5 px-1 text-footnote text-ink-2">Seneste kald fra Claude på din træning</h3>
      <ErrorText>{error}</ErrorText>
      {audit && audit.length === 0 && <Muted className="px-1">Ingen kald endnu.</Muted>}
      {audit && audit.length > 0 && (
        <ul className="inset-list overflow-hidden rounded-card bg-surface text-footnote">
          {audit.map((a, i) => (
            <li key={i} className="flex min-h-11 items-center gap-3 px-4 py-1.5">
              <span className="num w-28 shrink-0 text-ink-2">{TIME.format(new Date(a.at))}</span>
              <span className="min-w-0 flex-1 font-mono text-xs break-all">
                {a.tool}
                {a.user && a.user !== me.user.name && <span className="font-sans text-ink-2"> · {a.user}</span>}
              </span>
              <span className={a.ok ? 'text-ink' : 'text-danger'}>{a.ok ? 'ok' : a.error ? ERRORS[a.error] : 'fejl'}</span>
            </li>
          ))}
        </ul>
      )}
    </Group>
  );
}
