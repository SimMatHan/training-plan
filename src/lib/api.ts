import { getToken, setToken } from './token';

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
  token?: string;
}

export async function api<T>(path: string, { json, token, headers, ...init }: ApiInit = {}): Promise<T> {
  const auth = token ?? getToken();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(auth && { Authorization: `Bearer ${auth}` }),
        ...(json !== undefined && { 'Content-Type': 'application/json' }),
        ...headers,
      },
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
    // Et afvist token (ikke et der testes i login-skærmen) logger ud.
    if (res.status === 401 && !token) setToken(null);
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}
