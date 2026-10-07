// Udskiftelig auth. requireAuth() tager en liste af strategier og accepterer
// den første der genkender kalderen. Fase 3 tilføjer en OAuth-strategi til
// MCP-connectoren ved siden af bearer-tokenet, uden at røre routes.
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './env';

export type Principal = { kind: 'token' } | { kind: 'oauth'; clientId: string; scopes: string[] };

export type AuthStrategy = (c: Context<AppEnv>) => Promise<Principal | null>;

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** Konstant-tids sammenligning. Hasher først, så længden ikke lækker. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Lang bearer-token fra Worker secret API_TOKEN. Mangler secret'en, afvises alt. */
export const bearerToken = (): AuthStrategy => async (c) => {
  const expected = c.env.API_TOKEN;
  const header = c.req.header('Authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!expected || !match) return null;
  return (await safeEqual(match[1].trim(), expected)) ? { kind: 'token' } : null;
};

export const requireAuth = (...strategies: AuthStrategy[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    for (const strategy of strategies) {
      const principal = await strategy(c);
      if (principal) {
        c.set('principal', principal);
        return next();
      }
    }
    return c.json({ error: 'Ikke autoriseret' }, 401, { 'WWW-Authenticate': 'Bearer' });
  });
