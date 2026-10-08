// /authorize: "Giv Claude adgang til Karos træningsdata?" Kræver en app-session (passkey-login);
// uden session sendes browseren til /login og tilbage hertil bagefter. Forbindelsen gælder den
// atlet, ressourcen peger på (/mcp/<slug>), og brugeren skal have adgang til atleten.
// Kun claude.ai's callback-URL'er accepteres som redirect_uri.
import { AuthorizationError, CimdFetchError, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { Role } from '../../shared/athletes';
import { sessionIdFrom } from '../auth';
import type { Env } from '../env';
import { getAthleteBySlug, getRole, type Athlete } from '../services/athletes';
import { getSessionUser, type SessionUser } from '../services/users';
import { slugFromMcpPath } from '../mcp/server';
import { CLAUDE_REDIRECT_URIS, isAllowedRedirect } from './redirects';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

const STYLE = `
  :root { color-scheme: light dark; --bg:#eef0ef; --fg:#23262a; --card:#f8f9f8; --line:rgb(35 38 42/.16); --muted:#5b6066; --err:#b02a24; }
  @media (prefers-color-scheme: dark) { :root { --bg:#23262a; --fg:#eef0ef; --card:#2b2f34; --line:rgb(238 240 239/.16); --muted:#a7adb2; --err:#f07a72; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg);
         font:17px/1.45 system-ui, -apple-system, sans-serif; padding:16px; }
  main { width:100%; max-width:380px; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:24px; }
  h1 { font-size:1.4rem; margin:0 0 8px; }
  p { margin:0 0 12px; color:var(--muted); font-size:.95rem; }
  strong { color:var(--fg); }
  .row { display:flex; gap:8px; margin-top:16px; }
  button { flex:1; min-height:48px; font:inherit; font-weight:600; border-radius:10px; border:1px solid var(--line); background:transparent; color:inherit; cursor:pointer; }
  button[value=approve] { background:var(--fg); color:var(--bg); border-color:var(--fg); }
  .err { color:var(--err); font-weight:600; }
`;

/**
 * form-action gælder også redirectet efter formularen (302 til Claudes callback), så de
 * tilladte callback-origins skal stå der; ellers blokerer browseren det sidste trin.
 */
function csp(allowLocalhost: boolean): string {
  const targets = ["'self'", ...new Set(CLAUDE_REDIRECT_URIS.map((u) => new URL(u).origin)), ...(allowLocalhost ? ['http://localhost:*', 'http://127.0.0.1:*'] : [])];
  return `default-src 'none'; style-src 'unsafe-inline'; form-action ${targets.join(' ')}; frame-ancestors 'none'; base-uri 'none'`;
}

function page(body: string, opts: { status?: number; headers?: Headers; allowLocalhost: boolean }): Response {
  const h = new Headers(opts.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v);
  h.set('Content-Security-Policy', csp(opts.allowLocalhost));
  const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Giv Claude adgang · Træningsnav</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, { status: opts.status ?? 200, headers: h });
}


const ROLE_TEXT: Record<Role, string> = { ejer: 'dig selv', traener: 'træner' };
const genitive = (name: string) => (/[sxz]$/i.test(name) ? `${name}'` : `${name}s`);

function form(handle: string, opts: { athlete: Athlete; user: SessionUser; role: Role; clientName?: string; redirectHost?: string }): string {
  const whose = genitive(opts.athlete.name);
  return `<h1>Giv Claude adgang til <strong>${escape(whose)}</strong> træningsdata?</h1>
<p>Du logger ind som <strong>${escape(opts.user.name)}</strong> (${ROLE_TEXT[opts.role]}).</p>
<p>${opts.clientName ? `<strong>${escape(opts.clientName)}</strong> beder om adgang. ` : ''}Forbindelsen indeholder kun ${escape(whose)} plan og logs.
Claude kan læse dem og foreslå ændringer, som ${escape(opts.athlete.name)} selv godkender i appen${opts.role === 'ejer' ? ', og logge løb og skrive noter' : ''}.
Claude kan ikke slette noget eller aktivere en plan.</p>
${opts.redirectHost ? `<p>Adgangen sendes til <strong>${escape(opts.redirectHost)}</strong>.</p>` : ''}
<form method="post" action="/authorize">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <div class="row">
    <button type="submit" name="decision" value="deny">Afvis</button>
    <button type="submit" name="decision" value="approve" autofocus>Giv adgang</button>
  </div>
</form>`;
}

/** Atleten som ressourcen (https://<domæne>/mcp/<slug>) peger på. */
async function athleteOf(env: Env, resource: string | string[] | undefined): Promise<Athlete | null> {
  const r = Array.isArray(resource) ? resource[0] : resource;
  if (!r) return null;
  const slug = slugFromMcpPath(new URL(r).pathname);
  return slug ? getAthleteBySlug(env.DB, slug) : null;
}

export async function handleAuthorize(request: Request, env: Env, oauth: OAuthHelpers): Promise<Response> {
  const allowLocalhost = env.OAUTH_ALLOW_LOCALHOST === 'true';
  const show = (body: string, status = 200, headers?: Headers) => page(body, { status, headers, allowLocalhost });
  const message = (title: string, text: string, status: number) => show(`<h1>${escape(title)}</h1><p>${escape(text)}</p>`, status);
  const notAllowed = () => message('Ikke tilladt', 'Kun Claude (claude.ai) kan forbindes til Træningsnav.', 400);
  // Ingen adgang og ukendt atlet ser ens ud, så andre atleters eksistens ikke afsløres.
  const noAccess = (user: SessionUser) => message('Ingen adgang', `${user.name} har ikke adgang til denne forbindelse.`, 403);

  const sessionId = sessionIdFrom(request);
  const user = sessionId ? await getSessionUser(env.DB, sessionId) : null;

  try {
    if (request.method === 'GET') {
      const authRequest = await oauth.parseAuthRequest(request);
      if (!isAllowedRedirect(authRequest.redirectUri, allowLocalhost)) return notAllowed();
      if (!user) {
        // Log ind med passkey i appen og kom tilbage til samtykket.
        const url = new URL(request.url);
        return new Response(null, { status: 302, headers: { Location: `/login?next=${encodeURIComponent(url.pathname + url.search)}`, 'Cache-Control': 'no-store' } });
      }
      const athlete = await athleteOf(env, authRequest.resource);
      const role = athlete ? await getRole(env.DB, user.id, athlete.id) : null;
      if (!athlete || !role) return noAccess(user);
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      return show(form(consent.handle, { athlete, user, role, clientName: details.clientName, redirectHost: details.redirectHost }), 200, consent.headers);
    }

    if (request.method === 'POST') {
      const data = await request.formData();
      const handle = String(data.get('handle') ?? '');
      if (data.get('decision') !== 'approve' || !user) {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(request, handle);
      // Anmodningen kommer fra lageret, ikke fra formularen; tjek alligevel igen.
      if (!isAllowedRedirect(approved.request.redirectUri, allowLocalhost)) return notAllowed();
      const athlete = await athleteOf(env, approved.request.resource);
      const role = athlete ? await getRole(env.DB, user.id, athlete.id) : null;
      if (!athlete || !role) return noAccess(user);
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: String(user.id),
        metadata: { grantedAt: new Date().toISOString(), athlete: athlete.slug },
        scope: approved.request.scope,
        // MCP-handleren tjekker ved hvert kald, at stiens atlet er denne, og slår adgangen op live.
        props: { userId: user.id, athleteId: athlete.id, athleteSlug: athlete.slug },
      });
      approved.headers.set('Location', redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }

    return new Response('Metoden er ikke tilladt', { status: 405, headers: { Allow: 'GET, POST' } });
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo && request.method === 'GET') return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError) return message('Kan ikke fortsætte', `${e.description} Start forbindelsen forfra fra Claude.`, 400);
    if (e instanceof CimdFetchError) return message('Ukendt klient', 'Klienten kunne ikke verificeres.', 400);
    throw e;
  }
}
