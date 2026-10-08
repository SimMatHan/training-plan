// Login og adgang. Appen bruger en session-cookie (passkey-login, worker/routes/auth.ts);
// al adgang til en atlets data går gennem requireAccess.
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Role } from '../shared/athletes';
import type { AppEnv, Env } from './env';
import { resolveAccess, type Access } from './services/athletes';
import { ForbiddenError } from './services/errors';
import { getSessionUser, SESSION_TTL_MS } from './services/users';

export const SESSION_COOKIE = '__Host-tn_session';

/** Appens origin: APP_ORIGIN hvis sat, ellers den adresse kaldet kom ind på. */
export const appOrigin = (env: Pick<Env, 'APP_ORIGIN'>, url: string) => (env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : new URL(url).origin);

/** rpID for passkeys = appens værtsnavn. */
export const rpId = (env: Pick<Env, 'APP_ORIGIN'>, url: string) => new URL(appOrigin(env, url)).hostname;

export const clientIp = (c: Context<AppEnv>) => c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0].trim() ?? 'ukendt';

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Session-id'et fra cookien i en almindelig Request (bruges også af /authorize). */
export function sessionIdFrom(request: Request): string | null {
  const cookie = request.headers.get('Cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE.replace(/[-]/g, '\\-')}=([^;]+)`));
  return m ? m[1] : null;
}

/**
 * Mutationer (alt andet end GET/HEAD/OPTIONS) kræver, at Origin er appens eget domæne.
 * Sammen med SameSite=Lax stopper det CSRF.
 */
export const requireSameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
  const origin = c.req.header('Origin');
  if (!origin || origin !== appOrigin(c.env, c.req.url)) return c.json({ error: 'Forkert oprindelse' }, 403);
  return next();
});

/** Kræver en gyldig session. Sætter c.var.user. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const id = getCookie(c, SESSION_COOKIE);
  const user = id ? await getSessionUser(c.env.DB, id) : null;
  if (!user) return c.json({ error: 'Ikke logget ind' }, 401);
  c.set('user', user);
  return next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user.isAdmin) return c.json({ error: 'Kun for admin' }, 403);
  return next();
});

/**
 * Den eneste vej til en atlets data: brugerens adgang til atleten `athleteSlug` med mindst
 * `minRole`. Ingen adgang (eller ukendt atlet) giver 404, for lav rolle 403.
 */
export function requireAccess(c: Context<AppEnv>, athleteSlug: string, minRole: Role): Promise<Access> {
  return resolveAccess(c.env.DB, c.var.user.id, athleteSlug, minRole);
}

/** Middleware til /api/a/:slug: mindst træner. Sætter c.var.access. */
export const athleteAccess = createMiddleware<AppEnv>(async (c, next) => {
  c.set('access', await requireAccess(c, c.req.param('slug') ?? '', 'traener'));
  return next();
});

/** Kun atleten selv (ejer). Kaldes i handlere der ændrer noget. */
export function ownerOnly(c: Context<AppEnv>): Access {
  const access = c.var.access;
  if (access.role !== 'ejer') throw new ForbiddenError('Kun atleten selv kan gøre det');
  return access;
}
