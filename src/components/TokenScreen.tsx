import { useState, type FormEvent } from 'react';
import { api, ApiError, OfflineError } from '../lib/api';
import { setToken } from '../lib/token';

/** Vises én gang: tokenet testes mod API'et og gemmes på enheden. */
export function TokenScreen() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const token = value.trim();
    if (!token) return;
    setBusy(true);
    setError(undefined);
    try {
      await api('/plan/versions', { token });
      setToken(token);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Tokenet blev afvist.'
          : err instanceof OfflineError
            ? 'Ingen forbindelse. Tokenet kan kun gemmes med net.'
            : `Fejl: ${(err as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pt-safe mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 pb-16">
      <h1 className="mb-2 text-4xl">Træningsnav</h1>
      <p className="mb-8 text-muted">Indsæt API-tokenet. Det gemmes på denne enhed, så du kun skal gøre det én gang.</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="token" className="text-sm font-medium">
          API-token
        </label>
        <input
          id="token"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-12 rounded-lg border border-line bg-raised px-3 text-base"
        />
        {error && (
          <p role="alert" className="text-sm text-a-ink">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="min-h-12 rounded-lg bg-fg font-semibold text-bg disabled:opacity-40"
        >
          {busy ? 'Tjekker …' : 'Gem token'}
        </button>
      </form>
    </main>
  );
}
