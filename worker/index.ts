// Ét Worker-projekt: static assets (PWA) serveres direkte af Cloudflare, og kun
// /api/* rammer denne kode (run_worker_first i wrangler.jsonc).
import { Hono } from 'hono';
import { ZodError } from 'zod';
import { bearerToken, requireAuth } from './auth';
import type { AppEnv, Env } from './env';
import { planRoutes } from './routes/plan';
import { syncRoutes } from './routes/sync';
import { trendRoutes } from './routes/trends';

export const app = new Hono<AppEnv>().basePath('/api');

app.get('/health', (c) => c.json({ ok: true }));

// Fase 3: requireAuth(bearerToken(), oauth()) — samme routes, flere strategier.
app.use('*', requireAuth(bearerToken()));
app.route('/plan', planRoutes);
app.route('/sync', syncRoutes);
app.route('/trends', trendRoutes);

app.notFound((c) => c.json({ error: 'Ikke fundet' }, 404));

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: 'Ugyldige data', issues: err.issues }, 400);
  const status = (err as { status?: number }).status;
  if (status === 400 || status === 404 || status === 409) return c.json({ error: err.message }, status);
  console.error(err);
  return c.json({ error: 'Serverfejl' }, 500);
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return app.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
