// Skærmene uden for selve appen: log ind, invitation (første registrering og gendannelse) og
// onboarding for en ny bruger.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useSearch } from 'wouter';
import type { InviteInfo, Me, Sharing } from '../../shared/athletes';
import { signedIn } from '../data/session';
import { api, athleteApi } from '../lib/api';
import { ownAthlete, setMe, useAuth } from '../lib/auth';
import { fetchInvite, loginWithPasskey, passkeyError, registerWithInvite } from '../lib/passkeys';

function Shell({ children }: { children: ReactNode }) {
  return <main className="pt-safe mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 pb-16">{children}</main>;
}

const primary = 'min-h-14 w-full rounded-lg bg-fg text-lg font-semibold text-bg disabled:opacity-40';

export function Splash() {
  return (
    <Shell>
      <h1 className="text-4xl">Træningsnav</h1>
    </Shell>
  );
}

/** Kun stier til samtykket hos Claude (/authorize) må være "next" efter login. */
const safeNext = (next: string | null) => (next && /^\/authorize(\?|$)/.test(next) ? next : null);

/** "Log ind med passkey". Intet andet. Med ?next=/authorize… fortsætter den til Claude-samtykket bagefter. */
export function LoginPage() {
  const auth = useAuth();
  const [, navigate] = useLocation();
  const next = safeNext(new URLSearchParams(useSearch()).get('next'));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const expired = auth.status === 'out' && !!auth.me;

  // Allerede logget ind (fx fra claude.ai's samtykke): fortsæt med det samme.
  useEffect(() => {
    if (auth.status !== 'in') return;
    if (next) location.assign(next);
    else navigate('/', { replace: true });
  }, [auth.status, next, navigate]);

  async function login() {
    setBusy(true);
    setError(undefined);
    try {
      const me = await loginWithPasskey();
      if (next) {
        location.assign(next);
        return;
      }
      signedIn(me);
      navigate('/', { replace: true });
    } catch (e) {
      setError(passkeyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <h1 className="mb-2 text-4xl">Træningsnav</h1>
      <p className="mb-8 text-muted">
        {next
          ? 'Log ind for at give Claude adgang.'
          : expired
            ? `Log ind igen, ${auth.me!.user.name}. Det du har logget, ligger på telefonen og sendes, når du er logget ind.`
            : 'Log ind med Face ID.'}
      </p>
      {error && (
        <p role="alert" className="mb-3 text-sm text-a-ink">
          {error}
        </p>
      )}
      <button type="button" onClick={() => void login()} disabled={busy} className={primary}>
        {busy ? 'Logger ind …' : 'Log ind med passkey'}
      </button>
    </Shell>
  );
}

/** /invite/<token>: "Hej Karo. Opret adgang med Face ID". Også gendannelse af en mistet passkey. */
export function InvitePage({ token }: { token: string }) {
  const [, navigate] = useLocation();
  const [invite, setInvite] = useState<InviteInfo>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchInvite(token).then(setInvite, (e) => setError(passkeyError(e)));
  }, [token]);

  async function register() {
    setBusy(true);
    setError(undefined);
    try {
      signedIn(await registerWithInvite(token));
      navigate('/', { replace: true });
    } catch (e) {
      setError(passkeyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <h1 className="mb-2 text-4xl">{invite ? `Hej ${invite.name}` : 'Træningsnav'}</h1>
      {invite && (
        <p className="mb-8 text-muted">
          {invite.existingUser
            ? 'Opret en ny passkey med Face ID. Din historik og dine planer er der stadig.'
            : 'Opret adgang med Face ID. Der er ingen kodeord: din telefon er din nøgle.'}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-3 text-sm text-a-ink">
          {error}
        </p>
      )}
      {invite && (
        <button type="button" onClick={() => void register()} disabled={busy} className={primary}>
          {busy ? 'Opretter …' : 'Opret adgang med Face ID'}
        </button>
      )}
      {!invite && !error && <p className="text-muted">Henter invitationen …</p>}
    </Shell>
  );
}

/** Ny bruger: navn, tærskelpuls (valgfri) og et aktivt valg om inviteren må være træner. */
export function OnboardingPage({ me }: { me: Me }) {
  const own = ownAthlete(me);
  const [name, setName] = useState(me.user.name);
  const [hr, setHr] = useState('');
  const [coach, setCoach] = useState<boolean | null>(null);
  const [sharing, setSharing] = useState<Sharing>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (own) athleteApi<Sharing>(own.slug, '/sharing').then(setSharing, (e) => setError((e as Error).message));
  }, [own?.slug]);

  const inviter = sharing?.candidates[0];
  const thresholdHr = hr.trim() ? Number(hr) : null;
  const hrValid = thresholdHr === null || (Number.isInteger(thresholdHr) && thresholdHr >= 80 && thresholdHr <= 230);
  const ready = !!name.trim() && hrValid && !!sharing && (!inviter || coach !== null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      setMe(await api<Me>('/me/onboarding', { method: 'POST', json: { name: name.trim(), thresholdHr, coach: !!coach } }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Shell>
      <h1 className="mb-2 text-4xl">Velkommen</h1>
      <p className="mb-6 text-muted">Et par ting, før du går i gang.</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Navn
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="min-h-12 rounded-lg border border-line bg-raised px-3 text-base font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Tærskelpuls (valgfri)
          <input
            value={hr}
            inputMode="numeric"
            maxLength={3}
            onChange={(e) => setHr(e.target.value.replace(/\D/g, ''))}
            placeholder="Fx 172"
            className="num min-h-12 rounded-lg border border-line bg-raised px-3 text-base font-normal"
          />
          {!hrValid && <span className="text-a-ink">Mellem 80 og 230.</span>}
        </label>
        {inviter && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Må {inviter.name} se din træning og foreslå ændringer som træner?</legend>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: true, label: 'Ja' },
                { v: false, label: 'Nej' },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  aria-pressed={coach === o.v}
                  onClick={() => setCoach(o.v)}
                  className={`min-h-12 rounded-lg font-semibold ${coach === o.v ? 'bg-fg text-bg' : 'border border-line'}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm text-muted">Kan ændres senere under Indstillinger → Deling. Kun du kan logge og godkende ændringer.</p>
          </fieldset>
        )}
        {error && (
          <p role="alert" className="text-sm text-a-ink">
            {error}
          </p>
        )}
        <button type="submit" disabled={!ready || busy} className={primary}>
          {busy ? 'Gemmer …' : 'Kom i gang'}
        </button>
      </form>
    </Shell>
  );
}
