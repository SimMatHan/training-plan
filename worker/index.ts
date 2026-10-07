// Ét Worker-projekt: static assets (PWA) serveres direkte af Cloudflare, og kun
// /api/*, /cal/* og MCP/OAuth-stierne rammer denne kode (run_worker_first i wrangler.jsonc).
import { Hono } from 'hono';
import { z, ZodError } from 'zod';
import { bearerToken, requireAuth } from './auth';
import type { AppEnv, Env } from './env';
import { calendarRoutes, feedRoutes } from './routes/calendar';
import { exportRoutes, historyRoutes } from './routes/history';
import { isOAuthPath } from './oauth/redirects';
import { planRoutes } from './routes/plan';
import { mcpRoutes, proposalRoutes } from './routes/proposals';
import { syncRoutes } from './routes/sync';
import { trendRoutes } from './routes/trends';

// Valideringsfejl på dansk (API og MCP-værktøjer).
z.config(z.locales.da());

export const app = new Hono<AppEnv>().basePath('/api');

app.get('/health', (c) => c.json({ ok: true }));

// Kun appens bearer-token. MCP-connectorens OAuth-tokens gælder bevidst kun /mcp, så Claude
// aldrig kan godkende sine egne forslag eller aktivere en planversion via /api.
app.use('*', requireAuth(bearerToken()));
app.route('/plan', planRoutes);
app.route('/sync', syncRoutes);
app.route('/trends', trendRoutes);
app.route('/history', historyRoutes);
app.route('/export', exportRoutes);
app.route('/calendar', calendarRoutes);
app.route('/proposals', proposalRoutes);
app.route('/mcp', mcpRoutes);

app.notFound((c) => c.json({ error: 'Ikke fundet' }, 404));

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: 'Ugyldige data', issues: err.issues }, 400);
  const status = (err as { status?: number }).status;
  if (status === 400 || status === 404 || status === 409) return c.json({ error: err.message }, status);
  console.error(err);
  return c.json({ error: 'Serverfejl' }, 500);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return app.fetch(request, env, ctx);
    // Kalenderfeedet har sit eget token i URL'en (ikke bearer), så det ligger uden for /api.
    if (pathname.startsWith('/cal/')) return feedRoutes.fetch(request, env, ctx);
    // MCP-connectoren: /mcp (OAuth-beskyttet), /authorize, /oauth/* og OAuth-metadata.
    if (isOAuthPath(pathname)) {
      if (!env.OAUTH_KV || !env.OWNER_PASSWORD)
        return new Response('MCP-connectoren er ikke sat op: OAUTH_KV eller OWNER_PASSWORD mangler (se README).', { status: 503 });
      // Indlæses først her, så /api (og testene af den) ikke afhænger af OAuth- og MCP-pakkerne.
      const { oauthProvider } = await import('./oauth/provider');
      return oauthProvider(new URL(request.url).origin, env.OAUTH_ALLOW_LOCALHOST === 'true').fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
