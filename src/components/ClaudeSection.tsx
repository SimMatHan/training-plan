import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { McpAuditEntry } from '../../shared/proposals';
import { usePlan } from '../data/plan';
import { athleteApi, OfflineError } from '../lib/api';
import { useMe } from '../lib/auth';
import { Section } from './Screen';

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
    <Section title="Claude">
      <p className="mb-3 text-sm text-muted">
        Én forbindelse pr. atlet, så Claude aldrig blander jeres data. Tilføj adressen i claude.ai (Indstillinger → Connectors → Tilføj brugerdefineret
        connector, i en browser) og log ind med din passkey, når claude.ai beder om det.
      </p>
      <ul className="mb-4 flex flex-col gap-3">
        {me.athletes.map((a) => {
          const url = `${location.origin}/mcp/${a.slug}`;
          return (
            <li key={a.slug}>
              <p className="mb-1 text-sm font-medium">
                Træningsnav – {a.name}
                {a.role === 'traener' && <span className="font-normal text-muted"> (du er træner)</span>}
              </p>
              <div className="flex gap-2">
                <p className="num min-w-0 flex-1 rounded-lg border border-line bg-surface p-3 text-sm break-all select-all">{url}</p>
                <button type="button" onClick={() => void copy(url)} className="min-h-12 shrink-0 rounded-lg border border-line px-3 text-sm font-medium">
                  {copied === url ? 'Kopieret ✓' : 'Kopiér'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <Link href="/forslag" className="mb-4 flex min-h-12 items-center justify-center rounded-lg border border-line px-4 font-medium">
        Alle forslag
      </Link>
      <h3 className="mb-1 text-sm font-semibold text-muted">Seneste kald fra Claude på din træning</h3>
      {error && (
        <p role="alert" className="text-sm text-a-ink">
          {error}
        </p>
      )}
      {audit && audit.length === 0 && <p className="text-sm text-muted">Ingen kald endnu.</p>}
      {audit && audit.length > 0 && (
        <ul className="divide-y divide-line border-y border-line text-sm">
          {audit.map((a, i) => (
            <li key={i} className="flex min-h-10 items-center gap-3 py-1.5">
              <span className="num w-28 shrink-0 text-muted">{TIME.format(new Date(a.at))}</span>
              <span className="min-w-0 flex-1 font-mono text-xs break-all">
                {a.tool}
                {a.user && a.user !== me.user.name && <span className="font-sans text-muted"> · {a.user}</span>}
              </span>
              <span className={a.ok ? 'text-mob-ink' : 'text-a-ink'}>{a.ok ? 'ok' : a.error ? ERRORS[a.error] : 'fejl'}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
