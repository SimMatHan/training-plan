// Minimal D1Database oven på node:sqlite, så services kan testes uden Workers-runtime.
// Dækker den del af API'et som worker/services bruger: prepare/bind/first/all/run/batch/exec.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type Value = string | number | null;

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: Value[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params.map((p) => (typeof p === 'boolean' ? Number(p) : (p as Value) ?? null)));
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : { ...row }) as T;
  }

  async all<T>() {
    const rows = this.db.prepare(this.sql).all(...this.params).map((r) => ({ ...r }));
    return { results: rows as T[], success: true, meta: {} };
  }

  runSync() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }

  async run() {
    return this.runSync();
  }
}

export function createTestD1(db = new DatabaseSync(':memory:')): D1Database {
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => s.runSync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
  return d1 as unknown as D1Database;
}

const root = path.resolve(import.meta.dirname, '..');

export const migrationFiles = (dir = 'migrations') =>
  readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(path.join(root, dir, f), 'utf8') }));

/**
 * Database med alle migrationer og seed (atleten simon med planversion 1 og baseline-måling).
 * `cleanup` kører også migrations-pending/ (fase 5-oprydningen), så koden testes i begge tilstande.
 */
export async function createSeededD1(opts: { cleanup?: boolean } = {}): Promise<D1Database> {
  const d1 = createTestD1();
  for (const m of migrationFiles()) await d1.exec(m.sql);
  await d1.exec(readFileSync(path.join(root, 'plan/seed.sql'), 'utf8'));
  if (opts.cleanup) for (const m of migrationFiles('migrations-pending')) await d1.exec(m.sql);
  return d1;
}
