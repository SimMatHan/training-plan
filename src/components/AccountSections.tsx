// Indstillinger: konto, sikkerhed (passkeys), deling, overvågning og brugere (admin).
import { useEffect, useState, type FormEvent } from 'react';
import type { MobilityTest, Monitor, PasskeyInfo, Sharing, UserInfo } from '../../shared/athletes';
import { usePlan } from '../data/plan';
import { signOut } from '../data/session';
import { api, athleteApi, OfflineError } from '../lib/api';
import { useMe } from '../lib/auth';
import { formatWithYear } from '../lib/dates';
import { addPasskey, passkeyError } from '../lib/passkeys';
import { Section } from './Screen';

const errorText = (e: unknown) => (e instanceof OfflineError ? 'Ingen forbindelse. Prøv igen med net.' : (e as Error).message);
const button = 'min-h-12 rounded-lg border border-line px-4 font-medium disabled:opacity-40';
const input = 'min-h-12 rounded-lg border border-line bg-raised px-3 text-base text-fg';

function ErrorText({ error }: { error?: string }) {
  return error ? (
    <p role="alert" className="mb-3 text-sm text-a-ink">
      {error}
    </p>
  ) : null;
}

export function AccountSection() {
  const me = useMe();
  const [busy, setBusy] = useState(false);
  async function out() {
    if (!confirm('Log ud? Data på denne enhed slettes; alt synket ligger sikkert på serveren. Usendte ændringer går tabt.')) return;
    setBusy(true);
    await signOut();
  }
  return (
    <Section title="Konto">
      <p className="mb-3">
        Logget ind som <span className="font-semibold">{me.user.name}</span>
        {me.user.isAdmin && <span className="text-muted"> · admin</span>}
      </p>
      <button type="button" onClick={() => void out()} disabled={busy} className={button}>
        {busy ? 'Logger ud …' : 'Log ud'}
      </button>
    </Section>
  );
}

/** Indstillinger → Sikkerhed: passkeys med navn og sidst brugt. Den sidste kan ikke slettes. */
export function SecuritySection() {
  const [keys, setKeys] = useState<PasskeyInfo[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PasskeyInfo[]>('/me/passkeys').then(setKeys, (e) => setError(errorText(e)));
  }, []);

  async function run(action: () => Promise<PasskeyInfo[]>) {
    setBusy(true);
    setError(undefined);
    try {
      setKeys(await action());
    } catch (e) {
      setError(passkeyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Sikkerhed">
      <p className="mb-3 text-sm text-muted">Du logger ind med en passkey (Face ID). Passkeys fra iCloud-nøgleringen virker på alle dine Apple-enheder.</p>
      <ErrorText error={error} />
      {keys && (
        <ul className="mb-3 divide-y divide-line border-y border-line">
          {keys.map((k) => (
            <li key={k.id} className="flex min-h-14 items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{k.label}</div>
                <div className="text-sm text-muted">
                  Oprettet {formatWithYear(k.createdAt)}
                  {k.lastUsedAt && ` · sidst brugt ${formatWithYear(k.lastUsedAt)}`}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const label = prompt('Navn på passkey', k.label);
                  if (label?.trim()) void run(() => api(`/me/passkeys/${k.id}`, { method: 'PATCH', json: { label } }));
                }}
                className="min-h-12 rounded-lg px-2 text-sm font-medium text-muted"
              >
                Omdøb
              </button>
              <button
                type="button"
                disabled={busy || keys.length <= 1}
                onClick={() => confirm(`Slet passkey "${k.label}"?`) && void run(() => api(`/me/passkeys/${k.id}`, { method: 'DELETE' }))}
                className="min-h-12 rounded-lg px-2 text-sm font-medium text-a-ink disabled:opacity-30"
              >
                Slet
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" disabled={busy} onClick={() => void run(addPasskey)} className={button}>
        Tilføj passkey på denne enhed
      </button>
    </Section>
  );
}

/** Indstillinger → Deling: hvem har adgang til min træning. */
export function SharingSection() {
  const { slug } = usePlan();
  const me = useMe();
  const [sharing, setSharing] = useState<Sharing>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    athleteApi<Sharing>(slug, '/sharing').then(setSharing, (e) => setError(errorText(e)));
  }, [slug]);

  async function change(action: () => Promise<Sharing>) {
    setError(undefined);
    try {
      setSharing(await action());
    } catch (e) {
      setError(errorText(e));
    }
  }

  const others = sharing?.access.filter((a) => a.userId !== me.user.id) ?? [];
  return (
    <Section title="Deling">
      <p className="mb-3 text-sm text-muted">
        En træner kan se din uge, historik og Claudes forslag og bruge Claude til at lave dit program. Kun du kan logge og godkende forslag.
      </p>
      <ErrorText error={error} />
      {sharing && others.length === 0 && <p className="mb-3 text-sm">Kun du har adgang til din træning.</p>}
      {others.length > 0 && (
        <ul className="mb-3 divide-y divide-line border-y border-line">
          {others.map((a) => (
            <li key={a.userId} className="flex min-h-14 items-center gap-3 py-2">
              <div className="flex-1">
                <div className="font-medium">{a.name}</div>
                <div className="text-sm text-muted">Træner siden {formatWithYear(a.grantedAt)}</div>
              </div>
              <button
                type="button"
                onClick={() => confirm(`Fjern ${a.name}s adgang? Det gælder også Claude-forbindelsen med det samme.`) && void change(() => athleteApi(slug, `/sharing/${a.userId}`, { method: 'DELETE' }))}
                className="min-h-12 rounded-lg border border-line px-3 text-sm font-medium text-a-ink"
              >
                Fjern adgang
              </button>
            </li>
          ))}
        </ul>
      )}
      {sharing?.candidates.map((c) => (
        <button key={c.userId} type="button" onClick={() => void change(() => athleteApi(slug, '/sharing', { method: 'POST', json: { userId: c.userId } }))} className={`${button} mb-2 w-full`}>
          Giv {c.name} adgang som træner
        </button>
      ))}
    </Section>
  );
}

/** Indstillinger → Overvågning: smerte-monitors og mobilitetstests. */
export function MonitoringSection() {
  const { slug, profile, refresh } = usePlan();
  const [error, setError] = useState<string>();
  const [label, setLabel] = useState('');
  const [test, setTest] = useState({ name: '', unit: 'cm', perSide: true });

  async function act(path: string, method: 'POST' | 'PATCH', json: unknown) {
    setError(undefined);
    try {
      await athleteApi(slug, path, { method, json });
      await refresh();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }

  async function addMonitor(e: FormEvent) {
    e.preventDefault();
    if (label.trim() && (await act('/monitors', 'POST', { label }))) setLabel('');
  }

  async function addTest(e: FormEvent) {
    e.preventDefault();
    if (test.name.trim() && (await act('/mobility-tests', 'POST', test))) setTest({ name: '', unit: 'cm', perSide: true });
  }

  const toggle = (m: Monitor) => act(`/monitors/${m.id}`, 'PATCH', { active: !m.active });
  const toggleTest = (t: MobilityTest) => act(`/mobility-tests/${t.id}`, 'PATCH', { active: !t.active });

  return (
    <Section title="Overvågning">
      <p className="mb-3 text-sm text-muted">
        Smerte-monitors får en score efter hver træning og et spørgsmål morgenen efter (trafiklys). Mobilitetstests minder dig om en ny måling efter 14 dage.
      </p>
      <ErrorText error={error} />
      <h3 className="mb-1 text-sm font-semibold text-muted">Smerte</h3>
      <ul className="mb-2 divide-y divide-line border-y border-line">
        {profile?.monitors.map((m) => (
          <li key={m.id} className="flex min-h-12 items-center gap-3 py-1.5">
            <span className={`flex-1 ${m.active ? 'font-medium' : 'text-muted line-through'}`}>{m.label}</span>
            <button type="button" onClick={() => void toggle(m)} className="min-h-12 rounded-lg px-2 text-sm font-medium text-muted">
              {m.active ? 'Deaktivér' : 'Aktivér'}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={addMonitor} className="mb-5 flex gap-2">
        <input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="Fx Højre knæ" aria-label="Ny monitor" className={`${input} min-w-0 flex-1`} />
        <button type="submit" disabled={!label.trim()} className={button}>
          Tilføj
        </button>
      </form>

      <h3 className="mb-1 text-sm font-semibold text-muted">Mobilitetstests</h3>
      <ul className="mb-2 divide-y divide-line border-y border-line">
        {profile?.mobilityTests.map((t) => (
          <li key={t.id} className="flex min-h-12 items-center gap-3 py-1.5">
            <span className={`flex-1 ${t.active ? 'font-medium' : 'text-muted line-through'}`}>
              {t.name} <span className="font-normal text-muted">({t.unit}{t.per_side ? ', højre og venstre' : ''})</span>
            </span>
            <button type="button" onClick={() => void toggleTest(t)} className="min-h-12 rounded-lg px-2 text-sm font-medium text-muted">
              {t.active ? 'Deaktivér' : 'Aktivér'}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={addTest} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input value={test.name} maxLength={40} onChange={(e) => setTest({ ...test, name: e.target.value })} placeholder="Fx Knee-to-wall" aria-label="Ny test" className={`${input} min-w-0 flex-1`} />
          <input value={test.unit} maxLength={12} onChange={(e) => setTest({ ...test, unit: e.target.value })} aria-label="Enhed" className={`${input} w-20`} />
        </div>
        <label className="flex min-h-12 items-center gap-2 text-sm">
          <input type="checkbox" checked={test.perSide} onChange={(e) => setTest({ ...test, perSide: e.target.checked })} className="size-6" />
          Højre og venstre måles hver for sig
        </label>
        <button type="submit" disabled={!test.name.trim() || !test.unit.trim()} className={button}>
          Tilføj test
        </button>
      </form>
    </Section>
  );
}

/** Indstillinger → Brugere (kun admin): invitationer og brugere. */
export function UsersSection() {
  const [data, setData] = useState<{ users: UserInfo[]; invites: { name: string; isAdmin: boolean; userId: number | null; expiresAt: string }[] }>();
  const [error, setError] = useState<string>();
  const [name, setName] = useState('');
  const [admin, setAdmin] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [link, setLink] = useState<string>();

  const load = () => api<typeof data>('/admin/users').then(setData, (e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    try {
      const res = await api<{ url: string }>('/admin/invites', { method: 'POST', json: { name: name.trim(), isAdmin: admin, userId } });
      setLink(res.url);
      setName('');
      setAdmin(false);
      setUserId(null);
      void load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Section title="Brugere">
      <ErrorText error={error} />
      <form onSubmit={invite} className="mb-3 flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm text-muted">
          Inviter
          <select
            value={userId ?? ''}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              setUserId(id);
              const u = data?.users.find((x) => x.id === id);
              if (u) setName(u.name);
            }}
            className={input}
          >
            <option value="">Ny bruger</option>
            {data?.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} (ny passkey — gendannelse)
              </option>
            ))}
          </select>
        </label>
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Navn, fx Karo" aria-label="Navn" disabled={userId !== null} className={input} />
        <label className="flex min-h-12 items-center gap-2 text-sm">
          <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} className="size-6" />
          Admin (kan invitere andre)
        </label>
        <button type="submit" disabled={!name.trim()} className={button}>
          Opret invitation
        </button>
      </form>
      {link && (
        <div className="mb-4">
          <p className="mb-1 text-sm text-muted">Linket gælder i 7 dage og kan bruges én gang. Send det til personen; det åbnes på telefonen.</p>
          <p className="num rounded-lg border border-line bg-surface p-3 text-sm break-all select-all">{link}</p>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(link)} className={`${button} mt-2`}>
            Kopiér link
          </button>
        </div>
      )}
      {data && (
        <ul className="divide-y divide-line border-y border-line text-sm">
          {data.users.map((u) => (
            <li key={u.id} className="flex min-h-12 items-center gap-3 py-1.5">
              <span className="flex-1 font-medium">
                {u.name}
                {u.isAdmin && <span className="font-normal text-muted"> · admin</span>}
              </span>
              <span className="text-muted">
                {u.athletes.map((a) => `${a.slug} (${a.role})`).join(', ')} · {u.passkeys} {u.passkeys === 1 ? 'passkey' : 'passkeys'}
              </span>
            </li>
          ))}
          {data.invites.map((i, n) => (
            <li key={`i${n}`} className="flex min-h-12 items-center gap-3 py-1.5 text-muted">
              <span className="flex-1">Invitation: {i.name}{i.userId ? ' (gendannelse)' : ''}</span>
              <span>udløber {formatWithYear(i.expiresAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
