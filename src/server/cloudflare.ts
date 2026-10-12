import { DurableObject } from "cloudflare:workers";
import { makeApp } from "./app";
import { Store, type Database } from "./store";
import { tick } from "./jobs";
interface Env {
  COMPANION: DurableObjectNamespace<Companion>;
  ASSETS: Fetcher;
  BESIDE_PASSWORD?: string;
  BESIDE_API_KEY?: string;
  BESIDE_API_MODEL?: string;
}
export class Companion extends DurableObject<Env> {
  private db: Database;
  private store: Store;
  private app: ReturnType<typeof makeApp>;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = {
      all: (sql, ...p) => ctx.storage.sql.exec(sql, ...p).toArray(),
      run: (sql, ...p) => {
        ctx.storage.sql.exec(sql, ...p);
      },
      exec: (sql) => {
        ctx.storage.sql.exec(sql);
      },
      transaction: (fn) => ctx.storage.transactionSync(fn),
    };
    this.store = new Store(this.db);
    this.app = makeApp(this.db, {
      local: false,
      password: env.BESIDE_PASSWORD,
      apiKey: env.BESIDE_API_KEY,
      apiModel: env.BESIDE_API_MODEL,
    });
  }
  async fetch(request: Request) {
    if (!(await this.ctx.storage.getAlarm())) {
      tick(this.store);
      await this.ctx.storage.setAlarm(Date.now() + 60000);
    }
    return this.app.fetch(request);
  }
  async alarm() {
    try {
      tick(this.store);
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + 60000);
    }
  }
}
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/"))
      return env.COMPANION.get(env.COMPANION.idFromName("personal")).fetch(
        request,
      );
    const res = await env.ASSETS.fetch(request);
    const secured = new Response(res.body, res);
    secured.headers.set("X-Content-Type-Options", "nosniff");
    secured.headers.set("Referrer-Policy", "no-referrer");
    secured.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    return secured;
  },
} satisfies ExportedHandler<Env>;
