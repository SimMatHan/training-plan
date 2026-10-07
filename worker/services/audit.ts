// Revisionslog for MCP-kald og rate limit for kodeordet på /authorize.
// Logger aldrig input-indhold: kun værktøj, tidspunkt og udfald.

export type McpErrorKind = 'ugyldigt-input' | 'ikke-fundet' | 'konflikt' | 'serverfejl';

export interface McpAuditEntry {
  at: string;
  tool: string;
  ok: boolean;
  error: McpErrorKind | null;
  durationMs: number | null;
}

export async function recordMcpCall(db: D1Database, e: Omit<McpAuditEntry, 'at'>, now = new Date().toISOString()): Promise<void> {
  await db
    .prepare('INSERT INTO mcp_audit (at, tool, ok, error, duration_ms) VALUES (?, ?, ?, ?, ?)')
    .bind(now, e.tool.slice(0, 64), e.ok ? 1 : 0, e.error, e.durationMs)
    .run();
}

export async function listMcpAudit(db: D1Database, limit = 20): Promise<McpAuditEntry[]> {
  const { results } = await db
    .prepare('SELECT at, tool, ok, error, duration_ms FROM mcp_audit ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all<{ at: string; tool: string; ok: number; error: McpErrorKind | null; duration_ms: number | null }>();
  return results.map((r) => ({ at: r.at, tool: r.tool, ok: r.ok === 1, error: r.error, durationMs: r.duration_ms }));
}

/** Højst så mange forkerte kodeord inden for vinduet, samlet for alle afsendere. */
export const AUTH_MAX_FAILURES = 5;
export const AUTH_WINDOW_MS = 15 * 60_000;

/** Forkerte forsøg i vinduet, og hvornår det næste forsøg er tilladt, hvis grænsen er nået. */
export async function authAttemptStatus(db: D1Database, now = new Date()): Promise<{ allowed: boolean; retryAt: string | null }> {
  const since = new Date(now.getTime() - AUTH_WINDOW_MS).toISOString();
  const { results } = await db
    .prepare('SELECT at FROM auth_attempts WHERE ok = 0 AND at > ? ORDER BY at')
    .bind(since)
    .all<{ at: string }>();
  if (results.length < AUTH_MAX_FAILURES) return { allowed: true, retryAt: null };
  // Det ældste af de sidste AUTH_MAX_FAILURES forsøg skal ud af vinduet.
  const oldest = results[results.length - AUTH_MAX_FAILURES].at;
  return { allowed: false, retryAt: new Date(Date.parse(oldest) + AUTH_WINDOW_MS).toISOString() };
}

export async function recordAuthAttempt(db: D1Database, ok: boolean, now = new Date()): Promise<void> {
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  await db.batch([
    db.prepare('INSERT INTO auth_attempts (at, ok) VALUES (?, ?)').bind(now.toISOString(), ok ? 1 : 0),
    db.prepare('DELETE FROM auth_attempts WHERE at < ?').bind(dayAgo),
  ]);
}
