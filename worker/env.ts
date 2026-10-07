import type { Principal } from './auth';

/** Bindings fra wrangler.jsonc og secrets. */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Sættes med `wrangler secret put API_TOKEN` (lokalt i .dev.vars). */
  API_TOKEN?: string;
  /** Token i kalenderfeedets URL (/cal/<token>.ics). Sættes med `wrangler secret put CAL_TOKEN`. */
  CAL_TOKEN?: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { principal: Principal };
}
