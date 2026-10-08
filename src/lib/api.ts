import { markLoggedOut } from './auth';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Fejl der skyldes manglende net (fetch afvist), ikke serveren. */
export class OfflineError extends Error {}

interface ApiInit extends Omit<RequestInit, 'body'> {
  json?: unknown;
  /** Et 401 her betyder ikke "logget ud" (fx under login). */
  anonymous?: boolean;
}

/** Kald til /api med session-cookien. Et 401 viser login-skærmen; lokale data og udbakken bevares. */
export async function api<T>(path: string, { json, anonymous, headers, ...init }: ApiInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { ...(json !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      ...(json !== undefined && { body: JSON.stringify(json) }),
    });
  } catch {
    throw new OfflineError('Ingen forbindelse');
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      // Ikke JSON.
    }
    if (res.status === 401 && !anonymous) markLoggedOut();
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

/** Kald for én atlet: /api/a/<slug>/… */
export const athleteApi = <T>(slug: string, path: string, init?: ApiInit) => api<T>(`/a/${encodeURIComponent(slug)}${path}`, init);
