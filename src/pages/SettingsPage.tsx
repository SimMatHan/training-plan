import { useEffect, useState } from 'react';
import type { PlanVersionMeta } from '../../shared/records.schema';
import { CalendarSection } from '../components/CalendarSection';
import { Screen, Section } from '../components/Screen';
import { usePlan } from '../data/plan';
import { api } from '../lib/api';
import { formatWithYear } from '../lib/dates';
import { BUILD, useAppUpdate } from '../lib/appUpdate';
import { exportData } from '../lib/export';
import { setToken } from '../lib/token';

const sourceLabel: Record<PlanVersionMeta['source'], string> = {
  seed: 'fra Excel',
  manual: 'manuel',
  claude: 'fra Claude',
};

export function SettingsPage() {
  const { active, offline, refresh } = usePlan();
  const [versions, setVersions] = useState<PlanVersionMeta[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<number>();
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string>();

  const load = () =>
    api<PlanVersionMeta[]>('/plan/versions')
      .then(setVersions)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  async function activate(v: PlanVersionMeta) {
    if (!confirm(`Skift til planversion ${v.version}? Loghistorikken bevares.`)) return;
    setBusy(v.version);
    try {
      await api(`/plan/versions/${v.version}/activate`, { method: 'POST' });
      await Promise.all([load(), refresh()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  async function runExport() {
    setExporting(true);
    setExportMsg(undefined);
    try {
      const source = await exportData();
      setExportMsg(source === 'lokal' ? 'Offline: eksporterede den lokale kopi. Eksportér igen med net for den fulde version fra serveren.' : 'Eksporteret fra serveren.');
    } catch (e) {
      setExportMsg(`Eksport fejlede: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  const meta = active?.meta;

  return (
    <Screen title="Indstillinger">
      <Section title="Plan">
        {meta ? (
          <p className="mb-3">
            Aktiv: <span className="num font-semibold">version {meta.version}</span>{' '}
            <span className="text-muted">
              · {sourceLabel[meta.source]} · {formatWithYear(meta.created_at)}
            </span>
          </p>
        ) : (
          <p className="mb-3 text-muted">Ingen plan hentet endnu.</p>
        )}
        {offline && <p className="mb-3 text-sm text-muted">Offline — versioner kan skiftes, når der er net.</p>}
        {error && (
          <p role="alert" className="mb-3 text-sm text-a-ink">
            {error}
          </p>
        )}
        {versions && versions.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {versions.map((v) => (
              <li key={v.version} className="flex min-h-14 items-center gap-3 py-2">
                <div className="flex-1">
                  <div className="num font-semibold">Version {v.version}</div>
                  <div className="text-sm text-muted">
                    {sourceLabel[v.source]} · {formatWithYear(v.created_at)}
                    {v.note && ` · ${v.note}`}
                  </div>
                </div>
                {v.is_active ? (
                  <span className="text-sm font-medium text-mob-ink">Aktiv</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void activate(v)}
                    disabled={busy !== undefined}
                    className="min-h-12 rounded-lg border border-line px-4 text-sm font-medium disabled:opacity-40"
                  >
                    {busy === v.version ? 'Skifter …' : 'Brug denne'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <CalendarSection />

      <Section title="Data">
        <p className="mb-3 text-sm text-muted">Alle træninger, sæt, noter, lyske- og ankelmålinger samt planversioner som én JSON-fil.</p>
        <button
          type="button"
          onClick={() => void runExport()}
          disabled={exporting}
          className="min-h-12 rounded-lg border border-line px-4 font-medium disabled:opacity-40"
        >
          {exporting ? 'Eksporterer …' : 'Eksportér alle data (JSON)'}
        </button>
        {exportMsg && (
          <p role="status" className="mt-2 text-sm text-muted">
            {exportMsg}
          </p>
        )}
      </Section>

      <AppSection />

      <Section title="Enhed">
        <button
          type="button"
          onClick={() => confirm('Glem API-tokenet på denne enhed?') && setToken(null)}
          className="min-h-12 rounded-lg border border-line px-4 font-medium"
        >
          Glem token
        </button>
      </Section>
    </Screen>
  );
}

/** Version og manuel søgning efter opdateringer. */
function AppSection() {
  const { ready, apply, check } = useAppUpdate();
  const [state, setState] = useState<'idle' | 'checking' | 'none' | 'offline'>('idle');

  async function search() {
    setState('checking');
    const result = await check();
    setState(result === 'found' ? 'idle' : result);
  }

  return (
    <Section title="App">
      <p className="mb-3 text-sm text-muted">
        Version <span className="num font-medium text-fg">{BUILD.id}</span> · bygget {formatWithYear(BUILD.time)}
      </p>
      {ready ? (
        <button type="button" onClick={apply} className="min-h-12 rounded-lg bg-fg px-4 font-semibold text-bg">
          Opdater til ny version
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void search()}
          disabled={state === 'checking'}
          className="min-h-12 rounded-lg border border-line px-4 font-medium disabled:opacity-40"
        >
          {state === 'checking' ? 'Søger …' : 'Søg efter opdatering'}
        </button>
      )}
      {!ready && state === 'none' && (
        <p role="status" className="mt-2 text-sm text-muted">
          Du har den nyeste version.
        </p>
      )}
      {!ready && state === 'offline' && (
        <p role="status" className="mt-2 text-sm text-muted">
          Ingen forbindelse. Prøv igen med net.
        </p>
      )}
    </Section>
  );
}
