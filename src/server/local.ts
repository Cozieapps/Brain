import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { sqlite } from "./sqlite";
import { Store } from "./store";
import { makeApp } from "./app";
import { tick } from "./jobs";
import { PlanLocal } from "../providers/plan-local";
const data = resolve(process.env.BESIDE_DATA_DIR ?? ".data");
mkdirSync(data, { recursive: true, mode: 0o700 });
const db = sqlite(data + "/beside.sqlite");
const store = new Store(db);
const plan = new PlanLocal(
  data + "/provider",
  fetch,
  process.env.BESIDE_PLAN_ELIGIBLE === "true",
);
await plan.init();
const port = Number(process.env.PORT ?? 3000);
const app = makeApp(db, {
  local: true,
  password: process.env.BESIDE_PASSWORD || undefined,
  apiKey: process.env.BESIDE_API_KEY,
  apiModel: process.env.BESIDE_API_MODEL,
  plan,
  localPort: port,
});
app.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  await next();
});
app.use("*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));
const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () =>
  console.log(`Beside is running at http://127.0.0.1:${port}`),
);
tick(store);
const timer = setInterval(() => {
  try {
    tick(store);
  } catch {
    console.error("Worker check failed; it will retry on the next interval.");
  }
}, 30000);
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, () => {
    clearInterval(timer);
    plan.close();
    server.close();
    db.close();
    process.exit(0);
  });
