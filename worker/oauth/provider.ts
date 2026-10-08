// OAuth 2.1 med Dynamic Client Registration foran MCP (@cloudflare/workers-oauth-provider).
//
// Fase 5: én beskyttet ressource pr. atlet, https://<domæne>/mcp/<slug>. Authorization serveren
// kender alle atleters ressourcer, og tokens bindes til én af dem (RFC 8707 resource): et token
// til /mcp/karo afvises af /mcp/simon. Tokens, klienter og grants ligger i KV (OAUTH_KV).
// OAuth-tokens giver kun adgang til /mcp/<slug>, aldrig til /api.
import { OAuthAuthorizationServer, OAuthResourceServer } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../env';
import { mcpApiHandler, slugFromMcpPath } from '../mcp/server';
import { handleAuthorize } from './authorize';
import { isAllowedRedirect } from './redirects';

const PROTECTED_RESOURCE_PREFIX = '/.well-known/oauth-protected-resource';

export const resourceUrl = (origin: string, slug: string) => `${origin}/mcp/${slug}`;

// Ressourcelisten er fast for en server-instans; den skifter, når en atlet oprettes. Én instans
// pr. (origin, atleter), så domænet (workers.dev, eget domæne, localhost) kendes først ved kaldet.
const servers = new Map<string, OAuthAuthorizationServer<Env>>();

export function authorizationServer(origin: string, allowLocalhost: boolean, slugs: string[]): OAuthAuthorizationServer<Env> {
  const key = `${origin}|${allowLocalhost}|${slugs.join(',')}`;
  let server = servers.get(key);
  if (!server) {
    server = new OAuthAuthorizationServer<Env>({
      issuer: origin,
      resources: slugs.map((s) => resourceUrl(origin, s)),
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      accessTokenTTL: 3600,
      // Claude forbliver forbundet, så længe den bruges; en ubrugt forbindelse udløber efter 30 dage.
      refreshTokenTTL: 90 * 86_400,
      refreshTokenIdleTTL: 30 * 86_400,
      // Afvis klienter allerede ved registrering, hvis en redirect_uri ikke er claude.ai's.
      clientRegistrationCallback: ({ clientMetadata }) => {
        const uris = clientMetadata.redirect_uris;
        if (!Array.isArray(uris) || !uris.length || !uris.every((u) => typeof u === 'string' && isAllowedRedirect(u, allowLocalhost)))
          return { code: 'invalid_redirect_uri', description: 'Kun claude.ai kan forbindes til Træningsnav', status: 400 };
      },
    });
    if (servers.size > 20) servers.clear();
    servers.set(key, server);
  }
  return server;
}

const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/** Alt under /mcp, /authorize, /oauth/* og OAuth-metadata. */
export async function handleOAuth(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.OAUTH_KV) return text('MCP-forbindelsen er ikke sat op: OAUTH_KV mangler (se README).', 503);
  const url = new URL(request.url);
  const { pathname } = url;

  // Fase 3's fælles /mcp findes ikke længere: hver atlet har sin egen forbindelse.
  if (pathname === '/mcp' || pathname === '/mcp/' || pathname === `${PROTECTED_RESOURCE_PREFIX}/mcp`)
    return text('Træningsnav har nu én forbindelse pr. atlet. Brug https://<domæne>/mcp/<atlet>, fx /mcp/simon (se README).', 410);

  const origin = url.origin;
  const allowLocalhost = env.OAUTH_ALLOW_LOCALHOST === 'true';
  const { results } = await env.DB.prepare('SELECT slug, name FROM athletes ORDER BY id').all<{ slug: string; name: string }>();
  if (!results.length) return text('Ingen atleter endnu (kør migrationerne).', 503);
  const as = authorizationServer(
    origin,
    allowLocalhost,
    results.map((r) => r.slug),
  );

  const resourcePath = pathname.startsWith(`${PROTECTED_RESOURCE_PREFIX}/`) ? pathname.slice(PROTECTED_RESOURCE_PREFIX.length) : pathname;
  const slug = slugFromMcpPath(resourcePath);
  if (slug) {
    const athlete = results.find((r) => r.slug === slug);
    if (!athlete) return text('Ikke fundet', 404);
    const rs = new OAuthResourceServer<Env>({
      resourceMetadata: { resource: resourceUrl(origin, slug), authorization_servers: [origin], resource_name: `Træningsnav – ${athlete.name}` },
      handler: mcpApiHandler as never,
      validateToken: (e) => (resource, token) => as.validateToken(resource, token, e),
    });
    return rs.fetch(request, env, ctx);
  }

  if (pathname === '/authorize') return handleAuthorize(request, env, as.getOAuthApi(env));
  return as.fetch(request, env, ctx);
}
