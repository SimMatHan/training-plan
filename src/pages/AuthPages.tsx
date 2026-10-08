// Skærmene uden for selve appen: log ind, invitation (første registrering og gendannelse) og
// onboarding for en ny bruger.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useSearch } from 'wouter';
import type { InviteInfo, Me, Sharing } from '../../shared/athletes';
import { signedIn } from '../data/session';
import { api, athleteApi } from '../lib/api';
import { ownAthlete, setMe, useAuth } from '../lib/auth';
import { fetchInvite, loginWithPasskey, passkeyError, registerWithInvite } from '../lib/passkeys';
import { PrimaryButton } from '../ui/Button';
import { TextField } from '../ui/Field';
import { LargeTitle } from '../ui/LargeTitle';
import { ErrorText } from '../ui/Screen';
import { Segmented } from '../ui/Segmented';

/** Login, invitation og splash: hvid flade, appikonet i midten med en blød rød glød, knappen nederst. */
function Shell({ title = 'Træningsnav', line, children }: { title?: string; line?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface dark:bg-bg">
      <main className="pt-safe pb-safe mx-auto flex min-h-dvh max-w-sm flex-col px-6">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <img src="/apple-touch-icon.png" width={96} height={96} alt="" className="size-24 rounded-[22px] shadow-glow" />
          <h1 className="mt-6 text-[28px] leading-[34px] font-bold tracking-[-0.01em]">{title}</h1>
          {line && <p className="mt-1.5 text-body text-ink-2">{line}</p>}
        </div>
        {children && <div className="flex flex-col gap-3 pb-6">{children}</div>}
      </main>
    </div>
  );
}

export function Splash() {
  return <Shell />;
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
    <Shell
      line={
        next
          ? 'Log ind for at give Claude adgang.'
          : expired
            ? `Log ind igen, ${auth.me!.user.name}. Det du har logget, ligger på telefonen og sendes, når du er logget ind.`
            : 'Din træningsplan, logning og progression.'
      }
    >
      <ErrorText>{error}</ErrorText>
      <PrimaryButton onClick={() => void login()} disabled={busy}>
        {busy ? 'Logger ind …' : 'Log ind med Face ID'}
      </PrimaryButton>
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
    <Shell
      title={invite ? `Hej ${invite.name}` : 'Træningsnav'}
      line={
        invite
          ? invite.existingUser
            ? 'Opret en ny passkey med Face ID. Din historik og dine planer er der stadig.'
            : 'Opret adgang med Face ID. Der er ingen kodeord: din telefon er din nøgle.'
          : !error && 'Henter invitationen …'
      }
    >
      <ErrorText>{error}</ErrorText>
      {invite && (
        <PrimaryButton onClick={() => void register()} disabled={busy}>
          {busy ? 'Opretter …' : 'Opret adgang med Face ID'}
        </PrimaryButton>
      )}
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
    <main className="pt-safe mx-auto max-w-sm px-4 pb-12">
      <LargeTitle title="Velkommen" subtitle="Et par ting, før du går i gang." />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField label="Navn" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="Tærskelpuls (valgfri)"
          value={hr}
          inputMode="numeric"
          maxLength={3}
          onChange={(e) => setHr(e.target.value.replace(/\D/g, ''))}
          placeholder="Fx 172"
          hint={!hrValid && <span className="text-danger">Mellem 80 og 230.</span>}
        />
        {inviter && (
          <div>
            <p className="mb-1.5 text-footnote text-ink-2">Må {inviter.name} se din træning og foreslå ændringer som træner?</p>
            <Segmented
              label={`Må ${inviter.name} se din træning og foreslå ændringer som træner?`}
              value={coach === null ? '' : coach ? 'ja' : 'nej'}
              onChange={(v) => setCoach(v === 'ja')}
              options={[
                { value: 'ja', label: 'Ja' },
                { value: 'nej', label: 'Nej' },
              ]}
            />
            <p className="mt-2 text-footnote text-ink-2">Kan ændres senere under Indstillinger → Deling. Kun du kan logge og godkende ændringer.</p>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        <PrimaryButton type="submit" disabled={!ready || busy}>
          {busy ? 'Gemmer …' : 'Kom i gang'}
        </PrimaryButton>
      </form>
    </main>
  );
}
