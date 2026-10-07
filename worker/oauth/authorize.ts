// /authorize: "Giv Claude adgang til Træningsnav?" med et kodeordsfelt.
// Kodeordet er Worker secret OWNER_PASSWORD. Højst 5 forkerte forsøg pr. 15 min (samlet),
// og kun claude.ai's callback-URL'er accepteres som redirect_uri.
import { AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider';
import { safeEqual } from '../auth';
import type { Env } from '../env';
import { authAttemptStatus, recordAuthAttempt } from '../services/audit';
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
  label { display:block; font-weight:600; margin:16px 0 6px; }
  input[type=password] { width:100%; min-height:48px; font:inherit; padding:8px 12px; border-radius:10px; border:1px solid var(--line); background:transparent; color:inherit; }
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


function form(handle: string, opts: { clientName?: string; redirectHost?: string; error?: string }): string {
  return `<h1>Giv Claude adgang til Træningsnav?</h1>
<p>${opts.clientName ? `<strong>${escape(opts.clientName)}</strong> beder om adgang. ` : ''}Claude kan læse din plan og dine logs,
foreslå planændringer (som du selv godkender i appen), logge løb og skrive noter. Claude kan ikke slette noget eller aktivere en plan.</p>
${opts.redirectHost ? `<p>Adgangen sendes til <strong>${escape(opts.redirectHost)}</strong>.</p>` : ''}
${opts.error ? `<p class="err" role="alert">${escape(opts.error)}</p>` : ''}
<form method="post" action="/authorize">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <label for="password">Kodeord</label>
  <input id="password" name="password" type="password" autocomplete="current-password" autofocus>
  <div class="row">
    <button type="submit" name="decision" value="deny">Afvis</button>
    <button type="submit" name="decision" value="approve">Giv adgang</button>
  </div>
</form>`;
}

const clock = (iso: string) =>
  new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  if (!oauth) throw new Error('OAUTH_PROVIDER mangler; /authorize skal kaldes gennem OAuthProvider');
  const allowLocalhost = env.OAUTH_ALLOW_LOCALHOST === 'true';
  const show = (body: string, status = 200, headers?: Headers) => page(body, { status, headers, allowLocalhost });
  const message = (title: string, text: string, status: number) => show(`<h1>${escape(title)}</h1><p>${escape(text)}</p>`, status);
  if (!env.OWNER_PASSWORD) return message('Ikke sat op', 'OWNER_PASSWORD mangler på Worker’en (se README).', 503);

  try {
    if (request.method === 'GET') {
      const authRequest = await oauth.parseAuthRequest(request);
      if (!isAllowedRedirect(authRequest.redirectUri, allowLocalhost))
        return message('Ikke tilladt', 'Kun Claude (claude.ai) kan forbindes til Træningsnav.', 400);
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      return show(form(consent.handle, { clientName: details.clientName, redirectHost: details.redirectHost }), 200, consent.headers);
    }

    if (request.method === 'POST') {
      const data = await request.formData();
      const handle = String(data.get('handle') ?? '');
      if (data.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }

      const now = new Date();
      const limit = await authAttemptStatus(env.DB, now);
      if (!limit.allowed)
        return show(form(handle, { error: `For mange forkerte forsøg. Prøv igen efter kl. ${clock(limit.retryAt!)}.` }), 429);

      const password = String(data.get('password') ?? '');
      const ok = password.length > 0 && (await safeEqual(password, env.OWNER_PASSWORD));
      await recordAuthAttempt(env.DB, ok, now);
      if (!ok) return show(form(handle, { error: 'Forkert kodeord.' }), 401);

      const approved = await oauth.approveConsent(request, handle);
      // Anmodningen kommer fra lageret, ikke fra formularen; tjek alligevel igen.
      if (!isAllowedRedirect(approved.request.redirectUri, allowLocalhost))
        return message('Ikke tilladt', 'Kun Claude (claude.ai) kan forbindes til Træningsnav.', 400);
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: 'ejer',
        metadata: { grantedAt: now.toISOString() },
        scope: approved.request.scope,
        props: { owner: true },
      });
      approved.headers.set('Location', redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }

    return new Response('Metoden er ikke tilladt', { status: 405, headers: { Allow: 'GET, POST' } });
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo && request.method === 'GET') return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError)
      return message('Kan ikke fortsætte', `${e.description} Start forbindelsen forfra fra Claude.`, 400);
    if (e instanceof CimdFetchError) return message('Ukendt klient', 'Klienten kunne ikke verificeres.', 400);
    throw e;
  }
}
