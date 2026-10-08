// Kun claude.ai må modtage tokens. Lokalt (wrangler dev + MCP Inspector) kan
// OAUTH_ALLOW_LOCALHOST=true i .dev.vars tillade http://localhost-callbacks.

export const CLAUDE_REDIRECT_URIS = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'];

export function isAllowedRedirect(uri: string, allowLocalhost: boolean): boolean {
  if (CLAUDE_REDIRECT_URIS.includes(uri)) return true;
  if (!allowLocalhost) return false;
  try {
    const u = new URL(uri);
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/** Stier OAuth- og MCP-laget håndterer (/mcp/<slug>, /authorize, /oauth/*, metadata). */
export const isOAuthPath = (pathname: string) =>
  pathname === '/mcp' || pathname.startsWith('/mcp/') || pathname === '/authorize' || pathname.startsWith('/oauth/') || pathname.startsWith('/.well-known/oauth-');
