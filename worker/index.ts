// Ét Worker-projekt: static assets (PWA) serveres direkte af Cloudflare, og kun
// /api/*, /cal/* og MCP/OAuth-stierne rammer denne kode (run_worker_first i wrangler.jsonc).
import { Hono } from 'hono';
import { z, ZodError } from 'zod';
import { requireSameOrigin, requireSession } from './auth';
import type { AppEnv, Env } from './env';
import { isOAuthPath } from './oauth/redirects';
import { athleteRoutes } from './routes/athlete';
import { adminRoutes, authRoutes, meRoutes } from './routes/auth';
import { feedRoutes } from './routes/calendar';

// Valideringsfejl på dansk (API og MCP-værktøjer).
z.config(z.locales.da());

export const app = new Hono<AppEnv>().basePath('/api');

app.get('/health', (c) => c.json({ ok: true }));

// Mutationer skal komme fra appens eget domæne (CSRF), også login.
app.use('*', requireSameOrigin);
app.route('/auth', authRoutes);
app.route('/me', meRoutes);
app.route('/admin', adminRoutes);
// Al data om en atlet: /api/a/<slug>/… Kun med en app-session; MCP-tokens gælder kun /mcp/<slug>,
// så Claude aldrig kan godkende sine egne forslag eller aktivere en planversion via /api.
app.use('/a/:slug/*', requireSession);
app.route('/a/:slug', athleteRoutes);

app.notFound((c) => c.json({ error: 'Ikke fundet' }, 404));

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: 'Ugyldige data', issues: err.issues }, 400);
  const status = (err as { status?: number }).status;
  if (status === 400 || status === 403 || status === 404 || status === 409) return c.json({ error: err.message }, status);
  console.error(err);
  return c.json({ error: 'Serverfejl' }, 500);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return app.fetch(request, env, ctx);
    // Kalenderfeedet har sit eget token i URL'en, så det ligger uden for /api.
    if (pathname.startsWith('/cal/')) return feedRoutes.fetch(request, env, ctx);
    // MCP: /mcp/<slug> (OAuth-beskyttet), /authorize, /oauth/* og OAuth-metadata.
    if (isOAuthPath(pathname)) {
      // Indlæses først her, så /api (og testene af den) ikke afhænger af OAuth- og MCP-pakkerne.
      const { handleOAuth } = await import('./oauth/provider');
      return handleOAuth(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
