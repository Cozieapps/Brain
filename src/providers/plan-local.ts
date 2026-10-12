import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import lockfile from "proper-lockfile";
import {
  AUTH_ORIGIN,
  RESOURCE,
  beginAuthorization,
  exchange,
  verifyIdentity,
  type Registration,
  type Pending,
} from "./oauth";
import { infer, type InferenceInput } from "./responses";
interface Vault {
  hostId: string;
  registrations: Registration[];
  activeId?: string;
  model?: string;
}
export class PlanLocal {
  private pending?: Pending;
  private listener?: Server;
  private refreshes = new Map<string, Promise<Registration>>();
  private epoch = 0;
  private inflight = new Set<AbortController>();
  constructor(
    public dir: string,
    private network: typeof fetch = fetch,
    private eligible = false,
  ) {}
  get path() {
    return this.dir + "/credentials.json";
  }
  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700);
    try {
      await readFile(this.path);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      await writeFile(
        this.path,
        JSON.stringify({
          hostId: "urn:uuid:" + crypto.randomUUID(),
          registrations: [],
        }),
        { mode: 0o600, flag: "wx" },
      );
    }
    await chmod(this.path, 0o600);
  }
  async read(): Promise<Vault> {
    return JSON.parse(await readFile(this.path, "utf8"));
  }
  private async write(v: Vault) {
    const tmp = this.path + "." + crypto.randomUUID() + ".tmp";
    await writeFile(tmp, JSON.stringify(v), { mode: 0o600 });
    await rename(tmp, this.path);
  }
  async locked<T>(fn: (v: Vault) => Promise<T>) {
    const release = await lockfile.lock(this.path, {
      retries: { retries: 4, minTimeout: 100, maxTimeout: 500 },
      stale: 60000,
    });
    try {
      return await fn(await this.read());
    } finally {
      await release();
    }
  }
  async status() {
    const v = await this.read();
    const r = v.registrations.find((r) => r.id === v.activeId);
    return {
      available: true,
      eligible: this.eligible,
      reason: this.eligible
        ? ""
        : "Confirm this is an eligible open-source installation or approved private client before enabling ChatGPT plan access.",
      state: r?.accessToken
        ? r.expiresAt > Date.now() || r.refreshToken
          ? "connected"
          : "expired"
        : "unconfigured",
      profileId: r?.profileId ?? "personal",
      activeId: v.activeId,
      model: v.model,
      accounts: v.registrations.map((r) => ({
        id: r.id,
        label: `${r.label} · ${r.clientId.slice(-6)}`,
        hasPlan: r.scopes.includes("chatgpt.tokens.use.direct"),
        signedIn: !!r.accessToken,
      })),
      planAllowed: !!r?.scopes.includes("chatgpt.tokens.use.direct"),
    };
  }
  async authorize(
    browserId: string,
    appOrigin: string,
    registrationId?: string,
  ) {
    if (!this.eligible)
      throw new Error(
        "ChatGPT plan access is gated. Complete the eligibility steps in docs/CHATGPT.md, then set BESIDE_PLAN_ELIGIBLE=true in the local runtime.",
      );
    const v = await this.read();
    const selected = registrationId
      ? v.registrations.find((r) => r.id === registrationId)
      : undefined;
    if (registrationId && !selected) throw new Error("Unknown registration.");
    if (this.listener)
      throw new Error(
        "A sign-in is already pending. Finish it or wait ten minutes.",
      );
    const profileId =
      selected?.profileId ??
      (v.registrations.length ? "account:" + crypto.randomUUID() : "personal");
    const server = createServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'",
      );
      if (req.method !== "GET" || !req.url?.startsWith("/auth/callback?")) {
        res.writeHead(404).end();
        return;
      }
      const p = this.pending;
      this.pending = undefined;
      try {
        const cookie =
          (req.headers.cookie ?? "")
            .split(";")
            .map((x) => x.trim())
            .find((x) => x.startsWith("beside_browser="))
            ?.slice(15) ?? "";
        if (!p) throw new Error("Expired sign-in.");
        const r = await exchange(
          p,
          new URL(req.url, "http://127.0.0.1:1455"),
          cookie,
          v.hostId,
          this.network,
        );
        this.cancelRequests();
        await this.locked(async (current) => {
          const existing = current.registrations.find(
            (x) => x.clientId === r.clientId && x.subject === r.subject,
          );
          if (existing) {
            r.id = existing.id;
            r.profileId = existing.profileId;
          }
          const i = current.registrations.findIndex((x) => x.id === r.id);
          if (i >= 0) current.registrations[i] = r;
          else current.registrations.push(r);
          current.activeId = r.id;
          current.model = undefined;
          await this.write(current);
        });
        res.writeHead(302, { Location: appOrigin + "/?connected=1" }).end();
      } catch {
        res
          .writeHead(400, { "Content-Type": "text/plain" })
          .end(
            "Sign-in could not be verified or was declined. Return to Beside and try again. No account was replaced.",
          );
      } finally {
        server.close();
        this.listener = undefined;
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(1455, "127.0.0.1", resolve);
    });
    this.listener = server;
    const { pending, url } = await beginAuthorization(
      v.hostId,
      browserId,
      profileId,
      "http://127.0.0.1:1455/auth/callback",
      selected,
    );
    this.pending = pending;
    const timeout = setTimeout(() => {
      if (this.listener === server) {
        this.pending = undefined;
        server.close();
        this.listener = undefined;
      }
    }, 600000);
    timeout.unref();
    return url;
  }
  async refresh(id: string) {
    const existing = this.refreshes.get(id);
    if (existing) return existing;
    const promise = this.locked(async (v) => {
      const r = v.registrations.find((x) => x.id === id);
      if (!r?.accessToken) throw new Error("Sign in with ChatGPT first.");
      if (r.expiresAt > Date.now() + 60000) return r;
      if (!r.refreshToken) throw new Error("Session expired. Sign in again.");
      const res = await this.network(
        AUTH_ORIGIN + "/api/accounts/oauth/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: r.clientId,
            refresh_token: r.refreshToken,
            resource: RESOURCE,
          }),
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!res.ok) {
        if (res.status === 400 || res.status === 401) {
          delete r.accessToken;
          delete r.refreshToken;
          delete r.idToken;
          await this.write(v);
        }
        throw new Error(
          "ChatGPT session could not renew. No-AI is still available.",
        );
      }
      const t: any = await res.json();
      if (
        !t.access_token ||
        !t.expires_in ||
        t.token_type?.toLowerCase() !== "bearer"
      )
        throw new Error("Invalid renewal response.");
      if (t.id_token) {
        const identity = await verifyIdentity(t.id_token, r.clientId);
        if (identity.sub !== r.subject)
          throw new Error("Renewed account did not match.");
      }
      Object.assign(r, {
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? r.refreshToken,
        idToken: t.id_token ?? r.idToken,
        scopes: typeof t.scope === "string" ? t.scope.split(" ") : r.scopes,
        expiresAt: Date.now() + t.expires_in * 1000,
      });
      await this.write(v);
      return r;
    });
    this.refreshes.set(id, promise);
    try {
      return await promise;
    } finally {
      this.refreshes.delete(id);
    }
  }
  async models() {
    if (!this.eligible)
      throw new Error(
        "This installation has not been confirmed eligible for plan access.",
      );
    const v = await this.read();
    if (!v.activeId) throw new Error("Sign in first.");
    const r = await this.refresh(v.activeId);
    if (
      !r.scopes.includes("chatgpt.tokens.use.direct") ||
      !r.scopes.includes("resource.invoke")
    )
      throw new Error(
        "Identity is connected, but permission to use your plan was not granted.",
      );
    const res = await this.network(RESOURCE + "/models", {
      headers: { Authorization: `Bearer ${r.accessToken}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error("Could not load the models for this account.");
    const data: any = await res.json();
    return (data.models ?? [])
      .filter((m: any) => m.visibility === "list" && typeof m.slug === "string")
      .map((m: any) => ({ slug: m.slug, name: m.display_name ?? m.slug }));
  }
  cancelRequests() {
    this.epoch++;
    for (const c of this.inflight) c.abort();
    this.inflight.clear();
  }
  async select(id?: string) {
    this.cancelRequests();
    await this.locked(async (v) => {
      if (id && !v.registrations.some((r) => r.id === id))
        throw new Error("Unknown account.");
      v.activeId = id;
      v.model = undefined;
      await this.write(v);
    });
  }
  async selectModel(model: string) {
    const epoch = this.epoch;
    const models = await this.models();
    if (epoch !== this.epoch) throw new Error("Account changed.");
    if (!models.some((m: any) => m.slug === model))
      throw new Error("Choose a model available to this account.");
    await this.locked(async (v) => {
      if (epoch !== this.epoch) throw new Error("Account changed.");
      v.model = model;
      await this.write(v);
    });
  }
  async respond(p: InferenceInput, profileId: string) {
    if (!this.eligible)
      throw new Error(
        "This installation has not been confirmed eligible for plan access.",
      );
    const epoch = this.epoch;
    const v = await this.read();
    if (!v.activeId || !v.model)
      throw new Error(
        "Connect your ChatGPT account and choose an available model in Settings.",
      );
    const r = await this.refresh(v.activeId);
    if (
      r.profileId !== profileId ||
      !r.scopes.includes("chatgpt.tokens.use.direct") ||
      !r.scopes.includes("resource.invoke")
    )
      throw new Error("This profile has no plan permission.");
    if (epoch !== this.epoch) throw new Error("The account changed.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    this.inflight.add(controller);
    try {
      const answer = await infer(
        "plan",
        r.accessToken!,
        { ...p, model: v.model },
        controller.signal,
        this.network,
      );
      if (epoch !== this.epoch)
        throw new Error(
          "The account changed before completion. Nothing was applied.",
        );
      return answer;
    } finally {
      clearTimeout(timer);
      this.inflight.delete(controller);
    }
  }
  async signout() {
    this.cancelRequests();
    return this.locked(async (v) => {
      const r = v.registrations.find((x) => x.id === v.activeId);
      let revoked = false;
      if (r?.refreshToken) {
        try {
          const discovery = await this.network(
            AUTH_ORIGIN + "/.well-known/openid-configuration",
            { signal: AbortSignal.timeout(10000) },
          );
          const d: any = await discovery.json();
          const endpoint = new URL(d.revocation_endpoint);
          if (endpoint.origin !== AUTH_ORIGIN || d.issuer !== AUTH_ORIGIN)
            throw new Error("Invalid discovery.");
          for (let i = 0; i < 2; i++) {
            const res = await this.network(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                token: r.refreshToken,
                token_type_hint: "refresh_token",
                client_id: r.clientId,
              }),
              signal: AbortSignal.timeout(10000),
            });
            if (res.status === 200) {
              revoked = true;
              break;
            }
            if (res.status < 500) break;
            await new Promise((r) => setTimeout(r, 500));
          }
        } catch {
          /* explicit status below */
        }
      }
      if (r) {
        delete r.accessToken;
        delete r.refreshToken;
        delete r.idToken;
        r.scopes = [];
        r.expiresAt = 0;
      }
      await this.write(v);
      return {
        message: revoked
          ? "Signed out. The renewable session was revoked."
          : "Signed out locally. Remote revocation was not confirmed. Disconnect Beside in ChatGPT Settings → Security and login → Sign in with ChatGPT.",
      };
    });
  }
  close() {
    this.cancelRequests();
    this.listener?.close();
  }
}
