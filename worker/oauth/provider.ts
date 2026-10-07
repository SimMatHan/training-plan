// OAuth 2.1 med Dynamic Client Registration foran /mcp (@cloudflare/workers-oauth-provider).
// Tokens, klienter og grants ligger i KV (OAUTH_KV). Appens eget API_TOKEN på /api er urørt:
// OAuth-tokens giver kun adgang til /mcp, aldrig til /api.
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../env';
import { mcpApiHandler } from '../mcp/server';
import { handleAuthorize } from './authorize';
import { isAllowedRedirect } from './redirects';

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === '/authorize') return handleAuthorize(request, env);
    return new Response('Ikke fundet', { status: 404 });
  },
};

// Ressourcens URL skal stå i konfigurationen, men domænet kendes først ved kaldet
// (workers.dev, eget domæne, localhost). Én provider pr. origin.
const providers = new Map<string, OAuthProvider<Env>>();

export function oauthProvider(origin: string, allowLocalhost: boolean): OAuthProvider<Env> {
  const key = `${origin}|${allowLocalhost}`;
  let provider = providers.get(key);
  if (!provider) {
    provider = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: mcpApiHandler,
      defaultHandler,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      resourceMetadata: { resource: `${origin}/mcp`, resource_name: 'Træningsnav' },
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
    providers.set(key, provider);
  }
  return provider;
}
