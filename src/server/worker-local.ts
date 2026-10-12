import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { sqlite } from "./sqlite";
import { Store } from "./store";
import { tick } from "./jobs";
const dir = resolve(process.env.BESIDE_DATA_DIR ?? ".data");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const db = sqlite(dir + "/beside.sqlite");
const store = new Store(db);
tick(store);
console.log("Beside reminder worker running. No model calls.");
const timer = setInterval(() => tick(store), 30000);
for (const s of ["SIGINT", "SIGTERM"])
  process.on(s, () => {
    clearInterval(timer);
    db.close();
    process.exit(0);
  });
