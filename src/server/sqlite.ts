import { DatabaseSync } from "node:sqlite";
import type { Database } from "./store";
export function sqlite(path = ":memory:"): Database & { close: () => void } {
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;",
  );
  let depth = 0;
  return {
    all: (sql, ...p) => db.prepare(sql).all(...p),
    run: (sql, ...p) => {
      db.prepare(sql).run(...p);
    },
    exec: (sql) => {
      db.exec(sql);
    },
    transaction<T>(fn: () => T): T {
      if (depth) return fn();
      db.exec("BEGIN IMMEDIATE");
      depth++;
      try {
        const v = fn();
        db.exec("COMMIT");
        return v;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      } finally {
        depth--;
      }
    },
    close: () => db.close(),
  };
}
