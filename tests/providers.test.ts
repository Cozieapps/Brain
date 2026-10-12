import { describe, it, expect, vi } from "vitest";
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  createLocalJWKSet,
  jwtVerify,
} from "jose";
import {
  beginAuthorization,
  validateCallback,
  exchange,
  verifyIdentity,
  type Registration,
  AUTH_ORIGIN,
} from "../src/providers/oauth";
import {
  planPayload,
  apiPayload,
  readResponseStream,
} from "../src/providers/responses";
import { PlanLocal } from "../src/providers/plan-local";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
const model = {
  model: "account-model",
  instructions: "Be brief",
  input: [{ role: "user" as const, content: "Hello" }],
  maxOutput: 600,
};
function stream(events: any[]) {
  return new Response(
    events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
describe("documented plan request and terminal streaming", () => {
  it("plan adapter sends store false and stream true, omits preview-forbidden API fields", () => {
    const p = planPayload(model);
    expect(p.store).toBe(false);
    expect(p.stream).toBe(true);
    expect(Array.isArray(p.input)).toBe(true);
    for (const field of [
      "max_output_tokens",
      "max_tool_calls",
      "metadata",
      "temperature",
      "previous_response_id",
      "background",
      "conversation",
      "user",
      "top_p",
    ])
      expect(p).not.toHaveProperty(field);
    expect(apiPayload(model).max_output_tokens).toBe(600);
  });
  it("only releases a completed response; late quota, incomplete, malformed and interrupted streams fail", async () => {
    await expect(
      readResponseStream(
        stream([
          { type: "response.output_text.delta", delta: "Hello" },
          { type: "response.completed", response: { status: "completed" } },
        ]),
      ),
    ).resolves.toBe("Hello");
    await expect(
      readResponseStream(
        stream([
          { type: "response.output_text.delta", delta: "Partial action" },
          {
            type: "response.failed",
            response: {
              error: { code: "subscription_sharing_usage_limit_exceeded" },
            },
          },
        ]),
      ),
    ).rejects.toThrow(/usage/);
    await expect(
      readResponseStream(
        stream([{ type: "response.output_text.delta", delta: "Partial" }]),
      ),
    ).rejects.toThrow(/before completion/);
    await expect(
      readResponseStream(stream([{ type: "response.incomplete" }])),
    ).rejects.toThrow();
    await expect(
      readResponseStream(new Response("data: not-json\n\n")),
    ).rejects.toThrow(/malformed/);
  });
  it("handles SSE chunks split through CRLF delimiters, an event and UTF-8 text", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"type":"response.output_text.delta","delta":"café"}\r\n\r\ndata: {"type":"response.completed"}\r\n\r\n',
    );
    let i = 0;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          if (i >= bytes.length) {
            controller.close();
            return;
          }
          controller.enqueue(bytes.slice(i, i + 1));
          i++;
        },
      }),
    );
    expect(await readResponseStream(response)).toBe("café");
  });
});
describe("OAuth state, PKCE, nonce and registration separation", () => {
  it("new flow uses stable host, fresh state, nonce, PKCE and the documented loopback path", async () => {
    const a = await beginAuthorization(
      "urn:uuid:host",
      "browser",
      "personal",
      "http://127.0.0.1:1455/auth/callback",
    );
    const b = await beginAuthorization(
      "urn:uuid:host",
      "browser",
      "personal",
      "http://127.0.0.1:1455/auth/callback",
    );
    const url = new URL(a.url);
    expect(url.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(url.searchParams.get("agent_name_hint")).toBe("Beside");
    expect(url.searchParams.get("ext_agent_host_id")).toBe("urn:uuid:host");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain(
      "chatgpt.tokens.use.direct",
    );
    expect(a.pending.state).not.toBe(b.pending.state);
    expect(a.pending.nonce).not.toBe(b.pending.nonce);
    expect(url.searchParams.get("code_challenge")).not.toContain("=");
    await expect(
      beginAuthorization("h", "b", "p", "https://public.example/auth/callback"),
    ).rejects.toThrow(/loopback/);
    await expect(
      beginAuthorization("h", "b", "p", "http://localhost:1455/auth/callback"),
    ).rejects.toThrow();
  });
  it("missing, expired, replayed, cross-browser and mismatched callbacks cannot redeem codes", async () => {
    const { pending: p } = await beginAuthorization(
      "host",
      "browser",
      "personal",
      "http://127.0.0.1:1455/auth/callback",
    );
    const url = new URL(
      p.redirectUri +
        "?state=" +
        p.state +
        "&code=secret-code&client_id=oaiapp_issued",
    );
    expect(validateCallback(url, p, "browser").clientId).toBe("oaiapp_issued");
    expect(() => validateCallback(url, undefined, "browser")).toThrow();
    expect(() =>
      validateCallback(url, { ...p, expiresAt: 0 }, "browser"),
    ).toThrow();
    expect(() => validateCallback(url, p, "attacker")).toThrow();
    expect(() =>
      validateCallback(url, { ...p, state: "wrong" }, "browser"),
    ).toThrow();
    expect(() =>
      validateCallback(url, { ...p, clientId: "oaiapp_other" }, "browser"),
    ).toThrow();
    const noId = new URL(p.redirectUri + "?state=" + p.state + "&code=c");
    expect(() => validateCallback(noId, p, "browser")).toThrow(/issued/);
    const denied = new URL(
      p.redirectUri + "?state=" + p.state + "&error=access_denied",
    );
    const network = vi.fn();
    await expect(
      exchange(p, denied, "browser", "host", network),
    ).rejects.toThrow(/declined/);
    expect(network).not.toHaveBeenCalled();
  });
  it("signature/issuer/audience/expiry/nonce and subject bind an issued client; identity alone is not plan permission", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "test";
    const keys = createLocalJWKSet({ keys: [jwk] });
    const { pending: p } = await beginAuthorization(
      "host",
      "browser",
      "personal",
      "http://127.0.0.1:1455/auth/callback",
    );
    const sign = (
      claims: any = {},
      issuer = AUTH_ORIGIN,
      audience = "oaiapp_test",
      expiration = "5m",
    ) =>
      new SignJWT({ sub: "subject-A", nonce: p.nonce, ...claims })
        .setProtectedHeader({ alg: "RS256", kid: "test" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(expiration)
        .sign(privateKey);
    const verify = (token: string, client: string, nonce?: string) =>
      verifyIdentity(token, client, nonce, keys);
    const url = new URL(
      p.redirectUri + "?state=" + p.state + "&code=c&client_id=oaiapp_test",
    );
    const network = vi.fn();
    network.mockResolvedValue(
      new Response(
        JSON.stringify({
          id_token: await sign(),
          scope: "openid profile email",
        }),
      ),
    );
    const registration = await exchange(
      p,
      url,
      "browser",
      "host",
      network,
      verify,
    );
    expect(registration.scopes).not.toContain("chatgpt.tokens.use.direct");
    expect(registration.subject).toBe("subject-A");
    for (const token of [
      await sign({ nonce: "wrong" }),
      await sign({}, "https://evil.example"),
      await sign({}, AUTH_ORIGIN, "wrong"),
      await sign({}, AUTH_ORIGIN, "oaiapp_test", "-5m"),
    ]) {
      network.mockResolvedValueOnce(
        new Response(JSON.stringify({ id_token: token, scope: "openid" })),
      );
      await expect(
        exchange(p, url, "browser", "host", network, verify),
      ).rejects.toThrow();
    }
    network.mockResolvedValueOnce(
      new Response(JSON.stringify({ id_token: await sign(), scope: "openid" })),
    );
    await expect(
      exchange(
        { ...p, subject: "subject-B" },
        url,
        "browser",
        "host",
        network,
        verify,
      ),
    ).rejects.toThrow(/differs/);
  });
  it("reauthorization uses its own issued ID and hints, with no new-agent name", async () => {
    const r = {
      id: "one",
      clientId: "oaiapp_one",
      subject: "one",
      email: "same@example.test",
      idToken: "retained-hint",
    } as Registration;
    const { url } = await beginAuthorization(
      "host",
      "browser",
      "personal",
      "http://127.0.0.1:1455/auth/callback",
      r,
    );
    const u = new URL(url);
    expect(u.searchParams.get("client_id")).toBe("oaiapp_one");
    expect(u.searchParams.get("agent_name_hint")).toBeNull();
    expect(u.searchParams.get("id_token_hint")).toBe("retained-hint");
  });
});
describe("protected vault, account switching and refresh races", () => {
  it("serializes refresh, atomically rotates tokens, isolates registrations and keeps the host ID", async () => {
    const dir = await mkdtemp(tmpdir() + "/beside-vault-");
    const network = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return new Response(
        JSON.stringify({
          access_token: "new-test-access",
          refresh_token: "new-test-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "openid resource.invoke chatgpt.tokens.use.direct",
        }),
      );
    });
    const plan = new PlanLocal(dir, network);
    await plan.init();
    const v = await plan.read();
    const a: Registration = {
      id: "a",
      clientId: "oaiapp_a",
      profileId: "profile-a",
      subject: "subject-a",
      email: "same@example.test",
      hostId: v.hostId,
      label: "A",
      accessToken: "old-test-access",
      refreshToken: "old-test-refresh",
      expiresAt: 0,
      scopes: ["resource.invoke", "chatgpt.tokens.use.direct"],
    };
    const b = {
      ...a,
      id: "b",
      clientId: "oaiapp_b",
      profileId: "profile-b",
      subject: "subject-b",
      accessToken: "b-test-access",
      expiresAt: Date.now() + 3600000,
    };
    await writeFile(
      plan.path,
      JSON.stringify({ ...v, registrations: [a, b], activeId: "a" }),
      { mode: 0o600 },
    );
    const refreshed = await Promise.all([
      plan.refresh("a"),
      plan.refresh("a"),
      plan.refresh("a"),
    ]);
    expect(network).toHaveBeenCalledTimes(1);
    expect(refreshed[0].refreshToken).toBe("new-test-refresh");
    expect((await plan.read()).registrations[1].accessToken).toBe(
      "b-test-access",
    );
    await plan.select("b");
    expect((await plan.status()).profileId).toBe("profile-b");
    expect((await plan.read()).hostId).toBe(v.hostId);
    expect((await stat(plan.path)).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(await plan.status())).not.toContain("test-access");
    plan.close();
    await rm(dir, { recursive: true });
  });
  it("switching during inference aborts and never returns another account’s answer", async () => {
    const dir = await mkdtemp(tmpdir() + "/beside-switch-");
    let started!: () => void;
    const began = new Promise<void>((r) => (started = r));
    const network = vi.fn(
      (_url: any, options: any) =>
        new Promise<Response>((_resolve, reject) => {
          started();
          options.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const plan = new PlanLocal(dir, network as any, true);
    await plan.init();
    const v = await plan.read();
    const r: Registration = {
      id: "a",
      clientId: "oaiapp_a",
      profileId: "a-profile",
      subject: "a",
      email: "",
      hostId: v.hostId,
      label: "A",
      accessToken: "test",
      expiresAt: Date.now() + 3600000,
      scopes: ["resource.invoke", "chatgpt.tokens.use.direct"],
    };
    await writeFile(
      plan.path,
      JSON.stringify({ ...v, registrations: [r], activeId: "a", model: "one" }),
    );
    const request = plan.respond(model, "a-profile");
    const rejected = expect(request).rejects.toThrow(/aborted|changed/);
    await began;
    await plan.select();
    await rejected;
    expect((await plan.status()).profileId).toBe("personal");
    plan.close();
    await rm(dir, { recursive: true });
  });
});
