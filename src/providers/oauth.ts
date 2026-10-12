import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
export const AUTH_ORIGIN = "https://auth.openai.com";
export const RESOURCE = "https://api.openai.com/v1";
export const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export interface Registration {
  id: string;
  profileId: string;
  clientId: string;
  subject: string;
  email: string;
  hostId: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  scopes: string[];
  expiresAt: number;
  label: string;
}
export interface Pending {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
  clientId?: string;
  subject?: string;
  registrationId?: string;
  profileId: string;
  browserId: string;
}
export function randomValue(size = 32) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(size))).toString(
    "base64url",
  );
}
export async function beginAuthorization(
  hostId: string,
  browserId: string,
  profileId: string,
  redirectUri: string,
  registration?: Registration,
) {
  const uri = new URL(redirectUri);
  if (
    uri.protocol !== "http:" ||
    uri.hostname !== "127.0.0.1" ||
    uri.pathname !== "/auth/callback" ||
    uri.search ||
    uri.hash
  )
    throw new Error("Only the documented loopback callback is supported.");
  const pending: Pending = {
    state: randomValue(),
    nonce: randomValue(),
    verifier: randomValue(48),
    redirectUri,
    expiresAt: Date.now() + 600000,
    clientId: registration?.clientId,
    subject: registration?.subject,
    registrationId: registration?.id,
    profileId,
    browserId,
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(pending.verifier),
  );
  const url = new URL(AUTH_ORIGIN + "/api/accounts/authorize");
  url.search = new URLSearchParams({
    client_id: registration?.clientId ?? "dynamic_agent_client",
    ext_agent_host_id: hostId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    resource: RESOURCE,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge_method: "S256",
    code_challenge: Buffer.from(digest).toString("base64url"),
    ...(!registration ? { agent_name_hint: "Beside" } : {}),
    ...(registration?.idToken ? { id_token_hint: registration.idToken } : {}),
    ...(registration?.email ? { login_hint: registration.email } : {}),
  }).toString();
  return { pending, url: url.toString() };
}
export function validateCallback(
  url: URL,
  p: Pending | undefined,
  browserId: string,
) {
  if (
    !p ||
    p.expiresAt <= Date.now() ||
    url.origin + url.pathname !== p.redirectUri ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.get("state") !== p.state ||
    browserId !== p.browserId
  )
    throw new Error("Sign-in could not be verified. Start again.");
  if (url.searchParams.has("error"))
    throw new Error(
      "Sign-in was declined or unavailable. No-AI is still available.",
    );
  const issued = url.searchParams.get("client_id");
  if (p.clientId && issued && issued !== p.clientId)
    throw new Error("The registration did not match the selected account.");
  const clientId = p.clientId ?? issued;
  if (
    !clientId ||
    clientId === "dynamic_agent_client" ||
    !/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId)
  )
    throw new Error("Registration did not return an issued client ID.");
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.getAll("code").length !== 1)
    throw new Error("The callback did not include a valid code.");
  return { clientId, code };
}
const jwks = createRemoteJWKSet(
  new URL(AUTH_ORIGIN + "/.well-known/jwks.json"),
);
export async function verifyIdentity(
  token: string,
  clientId: string,
  nonce?: string,
  verificationKeys: JWTVerifyGetKey = jwks,
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, verificationKeys, {
    issuer: AUTH_ORIGIN,
    audience: clientId,
    requiredClaims: ["sub", "exp", "iat"],
    clockTolerance: 5,
    algorithms: ["RS256", "ES256"],
  });
  if (nonce !== undefined && payload.nonce !== nonce)
    throw new Error("ID-token nonce mismatch.");
  if (!payload.sub) throw new Error("Missing account identity.");
  return payload;
}
export async function exchange(
  p: Pending,
  url: URL,
  browserId: string,
  hostId: string,
  network: typeof fetch = fetch,
  verify = verifyIdentity,
): Promise<Registration> {
  const { clientId, code } = validateCallback(url, p, browserId);
  const res = await network(AUTH_ORIGIN + "/api/accounts/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: p.verifier,
      redirect_uri: p.redirectUri,
      resource: RESOURCE,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok)
    throw new Error(
      "Token exchange failed. Start a fresh sign-in; no credentials were changed.",
    );
  const t: any = await res.json();
  if (typeof t.id_token !== "string")
    throw new Error("No identity token was returned.");
  const identity = await verify(t.id_token, clientId, p.nonce);
  if (p.subject && identity.sub !== p.subject)
    throw new Error(
      "The signed-in account differs from the selected registration.",
    );
  const scopes = typeof t.scope === "string" ? t.scope.split(" ") : [];
  const plan =
    scopes.includes("chatgpt.tokens.use.direct") &&
    scopes.includes("resource.invoke");
  if (
    plan &&
    (!t.access_token ||
      t.token_type?.toLowerCase() !== "bearer" ||
      !Number.isFinite(t.expires_in) ||
      t.expires_in <= 0)
  )
    throw new Error("Plan credentials are incomplete.");
  return {
    id: p.registrationId ?? crypto.randomUUID(),
    profileId: p.profileId,
    clientId,
    subject: identity.sub!,
    email: typeof identity.email === "string" ? identity.email : "",
    hostId,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    idToken: t.id_token,
    scopes,
    expiresAt: Date.now() + (t.expires_in ?? 0) * 1000,
    label:
      typeof identity.email === "string" ? identity.email : "ChatGPT account",
  };
}
