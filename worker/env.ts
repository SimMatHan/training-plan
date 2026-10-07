import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { Principal } from './auth';

/** Bindings fra wrangler.jsonc og secrets. */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Sættes med `wrangler secret put API_TOKEN` (lokalt i .dev.vars). */
  API_TOKEN?: string;
  /** Token i kalenderfeedets URL (/cal/<token>.ics). Sættes med `wrangler secret put CAL_TOKEN`. */
  CAL_TOKEN?: string;
  /** Tokens, klienter og grants for MCP-connectorens OAuth (fase 3). */
  OAUTH_KV?: KVNamespace;
  /** Kodeordet på /authorize. Sættes med `wrangler secret put OWNER_PASSWORD`. */
  OWNER_PASSWORD?: string;
  /** Kun lokalt (.dev.vars): 'true' tillader http://localhost-callbacks, fx MCP Inspector. */
  OAUTH_ALLOW_LOCALHOST?: string;
  /** Sættes af OAuthProvider på kald til /authorize. */
  OAUTH_PROVIDER?: OAuthHelpers;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { principal: Principal };
}
