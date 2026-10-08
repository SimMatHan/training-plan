// Revisionslog for MCP-kald og rate limit for login og invitationer.
// Logger aldrig input-indhold: kun værktøj, tidspunkt, udfald, bruger og atlet.
import type { McpAuditEntry } from '../../shared/proposals';

export type McpErrorKind = NonNullable<McpAuditEntry['error']>;
export type { McpAuditEntry };

export async function recordMcpCall(
  db: D1Database,
  e: Omit<McpAuditEntry, 'at'> & { userId: number; athleteId: number },
  now = new Date().toISOString(),
): Promise<void> {
  await db
    .prepare('INSERT INTO mcp_audit (at, tool, ok, error, duration_ms, user_id, athlete_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(now, e.tool.slice(0, 64), e.ok ? 1 : 0, e.error, e.durationMs, e.userId, e.athleteId)
    .run();
}

/** De seneste kald for én atlet, med navnet på den bruger, hvis Claude kaldte. */
export async function listMcpAudit(db: D1Database, athleteId: number, limit = 20): Promise<McpAuditEntry[]> {
  const { results } = await db
    .prepare('SELECT a.at, a.tool, a.ok, a.error, a.duration_ms, u.name FROM mcp_audit a LEFT JOIN users u ON u.id = a.user_id WHERE a.athlete_id = ? ORDER BY a.id DESC LIMIT ?')
    .bind(athleteId, limit)
    .all<{ at: string; tool: string; ok: number; error: McpErrorKind | null; duration_ms: number | null; name: string | null }>();
  return results.map((r) => ({ at: r.at, tool: r.tool, ok: r.ok === 1, error: r.error, durationMs: r.duration_ms, user: r.name }));
}

/** Højst så mange forsøg (login og invitationer) pr. IP inden for vinduet. */
export const AUTH_MAX_ATTEMPTS = 10;
export const AUTH_WINDOW_MS = 15 * 60_000;

/** Forsøg fra IP'en i vinduet, og hvornår det næste er tilladt, hvis grænsen er nået. */
export async function authAttemptStatus(db: D1Database, ip: string, now = new Date()): Promise<{ allowed: boolean; retryAt: string | null }> {
  const since = new Date(now.getTime() - AUTH_WINDOW_MS).toISOString();
  const { results } = await db.prepare('SELECT at FROM auth_attempts WHERE ip = ? AND at > ? ORDER BY at').bind(ip, since).all<{ at: string }>();
  if (results.length < AUTH_MAX_ATTEMPTS) return { allowed: true, retryAt: null };
  // Det ældste af de sidste AUTH_MAX_ATTEMPTS forsøg skal ud af vinduet.
  const oldest = results[results.length - AUTH_MAX_ATTEMPTS].at;
  return { allowed: false, retryAt: new Date(Date.parse(oldest) + AUTH_WINDOW_MS).toISOString() };
}

export async function recordAuthAttempt(db: D1Database, ip: string, kind: string, ok: boolean, now = new Date()): Promise<void> {
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  await db.batch([
    db.prepare('INSERT INTO auth_attempts (at, ok, ip, kind) VALUES (?, ?, ?, ?)').bind(now.toISOString(), ok ? 1 : 0, ip, kind),
    db.prepare('DELETE FROM auth_attempts WHERE at < ?').bind(dayAgo),
  ]);
}
