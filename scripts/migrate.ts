import { mkdirSync } from "node:fs";
import { sqlite } from "../src/server/sqlite";
import { Store } from "../src/server/store";
const dir = process.env.BESIDE_DATA_DIR ?? ".data";
mkdirSync(dir, { recursive: true, mode: 0o700 });
const db = sqlite(dir + "/beside.sqlite");
new Store(db);
console.log(
  "Applied migrations:",
  db
    .all("SELECT version FROM schema_migrations")
    .map((r) => r.version)
    .join(", "),
);
db.close();
