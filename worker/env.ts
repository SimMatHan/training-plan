import type { Access } from './services/athletes';
import type { SessionUser } from './services/users';

/** Bindings fra wrangler.jsonc og secrets. */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Tokens, klienter og grants for MCP-forbindelsernes OAuth. */
  OAUTH_KV?: KVNamespace;
  /**
   * Appens faste adresse, fx https://traening.example.dk. Passkeys er bundet til domænet (rpID)
   * og Origin-tjekket bruger den. Uden den bruges adressen kaldet kom ind på.
   */
  APP_ORIGIN?: string;
  /** Kun lokalt (.dev.vars): 'true' tillader http://localhost-callbacks, fx MCP Inspector. */
  OAUTH_ALLOW_LOCALHOST?: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { user: SessionUser; access: Access };
}
