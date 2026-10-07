import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { McpAuditEntry } from '../../shared/proposals';
import { api, OfflineError } from '../lib/api';
import { Section } from './Screen';

const TIME = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const ERRORS: Record<NonNullable<McpAuditEntry['error']>, string> = {
  'ugyldigt-input': 'ugyldigt input',
  'ikke-fundet': 'ikke fundet',
  konflikt: 'konflikt',
  serverfejl: 'serverfejl',
};

/** Indstillinger → Claude: connector-adressen, forslag og de seneste 20 MCP-kald. */
export function ClaudeSection() {
  const [audit, setAudit] = useState<McpAuditEntry[]>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/mcp`;

  useEffect(() => {
    api<McpAuditEntry[]>('/mcp/audit').then(setAudit, (e: Error) => setError(e instanceof OfflineError ? 'Offline — loggen vises, når der er net.' : e.message));
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Kunne ikke kopiere. Markér adressen og kopiér den manuelt.');
    }
  }

  return (
    <Section title="Claude">
      <p className="mb-3 text-sm text-muted">
        Connector-adressen til claude.ai (Indstillinger → Connectors → Tilføj brugerdefineret connector, i en browser). Login sker med kodeordet
        OWNER_PASSWORD.
      </p>
      <p className="num mb-2 rounded-lg border border-line bg-surface p-3 text-sm break-all select-all">{url}</p>
      <div className="mb-4 flex gap-2">
        <button type="button" onClick={() => void copy()} className="min-h-12 flex-1 rounded-lg border border-line px-4 font-medium">
          {copied ? 'Kopieret ✓' : 'Kopiér adresse'}
        </button>
        <Link href="/forslag" className="flex min-h-12 flex-1 items-center justify-center rounded-lg border border-line px-4 font-medium">
          Alle forslag
        </Link>
      </div>
      <h3 className="mb-1 text-sm font-semibold text-muted">Seneste kald fra Claude</h3>
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
              <span className="min-w-0 flex-1 font-mono text-xs break-all">{a.tool}</span>
              <span className={a.ok ? 'text-mob-ink' : 'text-a-ink'}>{a.ok ? 'ok' : (a.error ? ERRORS[a.error] : 'fejl')}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
