import { useEffect, useState } from 'react';
import type { PlanVersionMeta } from '../../shared/records.schema';
import { Screen, Section } from '../components/Screen';
import { usePlan } from '../data/plan';
import { api } from '../lib/api';
import { formatWithYear } from '../lib/dates';
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
