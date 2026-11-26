// A throwaway in-memory database with the real schema, shaped like Cloudflare D1 so the
// production code in src/ runs unchanged. Each trial gets a fresh one.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The bench is bundled before it runs, so paths are relative to the project root (npm run bench).
const MIGRATIONS = "migrations";

export function createTestDb(): D1Database {
  const sql = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    sql.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  const stmt = (q: string, args: unknown[] = []): any => ({
    bind: (...a: unknown[]) => stmt(q, a),
    all: async () => ({ results: sql.prepare(q).all(...(args as any[])) }),
    first: async () => sql.prepare(q).get(...(args as any[])) ?? null,
    run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...(args as any[])).changes) } }),
    _run: () => sql.prepare(q).run(...(args as any[]))
  });
  return {
    prepare: (q: string) => stmt(q),
    batch: async (stmts: any[]) => {
      sql.exec("BEGIN");
      try {
        // Same shape as D1's batch results, which production code reads meta.changes from.
        const out = stmts.map((s) => ({ meta: { changes: Number(s._run().changes) } }));
        sql.exec("COMMIT");
        return out;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    }
  } as unknown as D1Database;
}
