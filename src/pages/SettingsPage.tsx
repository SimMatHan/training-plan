import { useEffect, useState } from 'react';
import type { PlanVersionMeta } from '../../shared/records.schema';
import { AccountSection, MonitoringSection, SecuritySection, SharingSection, UsersSection } from '../components/AccountSections';
import { CalendarSection } from '../components/CalendarSection';
import { ClaudeSection } from '../components/ClaudeSection';
import { PrimaryButton, SecondaryButton, smallButton } from '../ui/Button';
import { Card, Group } from '../ui/InsetList';
import { ErrorText, Muted, Screen } from '../ui/Screen';
import { usePlan } from '../data/plan';
import { athleteApi } from '../lib/api';
import { useMe } from '../lib/auth';
import { formatWithYear } from '../lib/dates';
import { BUILD, useAppUpdate } from '../lib/appUpdate';
import { exportData } from '../lib/export';

const sourceLabel: Record<PlanVersionMeta['source'], string> = {
  seed: 'fra Excel',
  manual: 'manuel',
  claude: 'fra Claude',
};

export function SettingsPage() {
  const { slug, active, offline, refresh } = usePlan();
  const me = useMe();
  const [versions, setVersions] = useState<PlanVersionMeta[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<number>();
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string>();

  const load = () =>
    athleteApi<PlanVersionMeta[]>(slug, '/plan/versions')
      .then(setVersions)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  async function activate(v: PlanVersionMeta) {
    if (!confirm(`Skift til planversion ${v.version}? Loghistorikken bevares.`)) return;
    setBusy(v.version);
    try {
      await athleteApi(slug, `/plan/versions/${v.version}/activate`, { method: 'POST' });
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
      const source = await exportData(slug);
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
      <AccountSection />

      <Group title="Plan">
        <Card className="mb-3">
          {meta ? (
            <p className="text-body">
              Aktiv: <span className="num font-semibold">version {meta.version}</span>{' '}
              <span className="text-ink-2">
                · {sourceLabel[meta.source]} · {formatWithYear(meta.created_at)}
              </span>
            </p>
          ) : (
            <Muted>Ingen plan hentet endnu.</Muted>
          )}
        </Card>
        {offline && <Muted className="mb-3 px-1">Offline — versioner kan skiftes, når der er net.</Muted>}
        <ErrorText className="mb-3">{error}</ErrorText>
        {versions && versions.length > 0 && (
          <ul className="inset-list overflow-hidden rounded-card bg-surface">
            {versions.map((v) => (
              <li key={v.version} className="flex min-h-14 items-center gap-3 px-4 py-2">
                <div className="flex-1">
                  <div className="num text-row">Version {v.version}</div>
                  <div className="text-footnote text-ink-2">
                    {sourceLabel[v.source]} · {formatWithYear(v.created_at)}
                    {v.note && ` · ${v.note}`}
                  </div>
                </div>
                {v.is_active ? (
                  <span className="text-secondary font-medium text-ink-2">Aktiv</span>
                ) : (
                  <button type="button" onClick={() => void activate(v)} disabled={busy !== undefined} className={smallButton('secondary')}>
                    {busy === v.version ? 'Skifter …' : 'Brug denne'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Group>

      <MonitoringSection />

      <SharingSection />

      <CalendarSection />

      <ClaudeSection />

      <SecuritySection />

      {me.user.isAdmin && <UsersSection />}

      <Group title="Data">
        <Muted className="mb-3 px-1">Alle dine træninger, sæt, noter, smerte- og mobilitetsmålinger samt planversioner som én JSON-fil.</Muted>
        <SecondaryButton onClick={() => void runExport()} disabled={exporting}>
          {exporting ? 'Eksporterer …' : 'Eksportér alle data (JSON)'}
        </SecondaryButton>
        {exportMsg && (
          <p role="status" className="mt-2 px-1 text-footnote text-ink-2">
            {exportMsg}
          </p>
        )}
      </Group>

      <AppSection />

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
    <Group title="App">
      <Muted className="mb-3 px-1">
        Version <span className="num font-medium text-ink">{BUILD.id}</span> · bygget {formatWithYear(BUILD.time)}
      </Muted>
      {ready ? (
        <PrimaryButton onClick={apply}>Opdater til ny version</PrimaryButton>
      ) : (
        <SecondaryButton onClick={() => void search()} disabled={state === 'checking'}>
          {state === 'checking' ? 'Søger …' : 'Søg efter opdatering'}
        </SecondaryButton>
      )}
      {!ready && state === 'none' && (
        <p role="status" className="mt-2 px-1 text-footnote text-ink-2">
          Du har den nyeste version.
        </p>
      )}
      {!ready && state === 'offline' && (
        <p role="status" className="mt-2 px-1 text-footnote text-ink-2">
          Ingen forbindelse. Prøv igen med net.
        </p>
      )}
    </Group>
  );
}
