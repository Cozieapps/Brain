# ChatGPT-plan integration

Documentation verified on 2026-10-12 from official sources:

- https://developers.openai.com/siwc/quickstart
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- https://developers.openai.com/siwc/token-sharing-open-source/token-reference
- https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
- https://developers.openai.com/siwc/website
- https://learn.chatgpt.com/docs/sign-in-with-chatgpt
- https://learn.chatgpt.com/docs/dots

Beside implements its own memory, obligations, checkpoints and reminders. It does not embed Dot or inherit any ChatGPT content, computer, connectors, conversation history or memory.

## Required user actions

1. Establish that this installation is eligible for the documented open-source flow, or obtain approval for a private client. The current documentation offers plan usage to open-source partners and selected private clients. An eligible Plus/Pro account is also required. A private repository and a license file alone do not prove approval. No source publication was performed.
2. For an eligible **local personal installation**, set `BESIDE_PLAN_ELIGIBLE=true` in `.env` and restart. This is an operator eligibility declaration, not an OpenAI approval grant. Incorrect declarations do not make a deployment eligible.
3. Open the main app at `http://127.0.0.1:3000` on the computer running the browser. Preferences → Continue with ChatGPT. The server starts the listener at **`http://127.0.0.1:1455/auth/callback`** before redirecting. Port 1455 must be free. Do not use `localhost`, a public URL, a reverse-proxy callback, or a Vite proxy as a substitute.
4. Sign in to your account and explicitly grant **Use your ChatGPT plan**. Identity-only consent never enables inference.
5. Load your available models, choose one, allow AI requests, and select “Use my ChatGPT plan.” Model discovery uses the selected account's `/v1/models` catalog and retains its `visibility: list` ordering.
6. In [ChatGPT Settings → Usage](https://chatgpt.com/#settings/Usage), set Beside's weekly app limit. Disable **Allow other apps to use credits after reaching your usage limit** if you want no credit spending beyond the plan allowance. Beside cannot manage billing settings on your behalf. Plus users share their plan's five-hour allowance across connected apps; an app has no separate allowance. Current Pro limits differ; consult the official usage page.

**Live account sign-in, actual consent scopes, model availability, quota behavior and remote revocation remain unverified until you complete these account steps.** Automated tests use mock tokens and failures, never another application's credentials.

## Implementation contract

- Initial authorization uses `client_id=dynamic_agent_client`, `agent_name_hint=Beside`, and a stable UUID-based `ext_agent_host_id` persisted per runtime. Returning authorization uses that registration's issued `oaiapp_…` client ID and associated ID-token/email hints, not a new registration.
- OAuth authorization code + PKCE S256; fresh state/nonce/verifier for each attempt. Ten-minute, one-use transaction bound to a browser cookie. Errors, missing state, mismatched browser, expiry, wrong callback, mismatched issued client, or identity fail closed. Tokens are exchanged server-side at `https://auth.openai.com/api/accounts/oauth/token`.
- Requested scopes: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`; resource `https://api.openai.com/v1`. Granted token-response scopes control plan access.
- `jose` verifies signature with OpenAI's JWKS, issuer, issued-client audience, expiration, issued-at, subject and nonce. Selected account identity must match before tokens replace an existing registration. Email does not identify a workspace.
- Credentials are in an atomic 0600 file in a 0700 runtime directory, separate from content SQLite, browser storage and exports. Each issued client and subject retain a separate registration. The first account uses the existing personal profile; additional accounts get isolated profiles. Explicit account selection changes profile and cancels in-flight requests. Signing out keeps that profile visible and removes tokens; selecting the personal profile is explicit.
- Refreshes are serialized per session and use a cross-process file lock, rotating credentials atomically. Reauthorization retains the registration/host mapping. Local sign-out attempts discovered revocation, retries a transient failure once with backoff, clears local tokens regardless and reports unconfirmed revocation.
- Plan inference uses only public `https://api.openai.com/v1/responses` with account-available model, array input, `store:false`, `stream:true`, and `instructions`. No API-only `max_output_tokens`, `temperature`, `background`, `previous_response_id`, or other preview-forbidden fields are sent.
- Text is buffered until `response.completed`. Failed, incomplete, malformed or interrupted streams—including quota errors after deltas—are discarded. No action is accepted from a partial stream.
- Request input is bounded: eight retrieved memories at most, one recommended task, six recent messages capped per message. One model request at a time per profile/process, one turn, zero automatic tool rounds, zero inference retries; default ten requests/day including failed attempts, configurable 1–50. Stream timeout 60 seconds, 2 MB byte cap. No idle inference or embeddings. The plan route does not support an output-token cap; use ChatGPT's own app limits.
- Models can propose an internal edit but never execute it directly. The user reviews typed actions, then the shared server registry revalidates schemas, dependencies, evidence, versions and current permissions. External communication, spending and deletion are not model tools.

## Personal self-hosted VM

The official VM procedure transfers a locally authorized renewable session. A loopback callback in the browser cannot reach a remote VM.

1. Install and initialize Beside on the VM (`npm ci && npm run migrate`, then start/stop once). This creates the VM's own stable host ID. Set a unique `BESIDE_PASSWORD`. Keep the Node server bound to loopback.
2. Complete OAuth on your own local computer with the same Beside client/user/workspace, following the local steps above. Stop the local Beside server before transfer.
3. List safe registration metadata with `npm run plan:transfer -- list`. Create an owner-only transfer file: `npm run plan:transfer -- export /secure/path/beside-session.json REGISTRATION_ID`. This intentionally removes the local access/refresh/ID tokens so the laptop cannot race the VM's refreshes. Never paste the file into chat or commit it.
4. Transfer that file over SSH, preserving restrictive permissions. On the stopped VM run `npm run plan:transfer -- import /secure/path/beside-session.json`. The importer verifies the signed identity, keeps the VM's existing host ID, and stores the registration in its protected vault. Import promptly while the ID token is valid; if expired, reauthorize locally and transfer afresh.
5. Remove the transfer files. Confirm eligibility and restart the VM with `BESIDE_PLAN_ELIGIBLE=true`. The VM owns subsequent refreshes. Access privately through an SSH tunnel to its loopback port, or an authenticated TLS reverse proxy with suitable deployment approval; don't expose an unauthenticated database. The supplied Node host guard accepts loopback requests, so configure a proxy to forward a loopback Host and correctly enforce external origin/TLS itself; SSH is the simpler supported operation.
6. Choose a model and enable plan mode in Preferences. Host-specific attribution/revocation for transferred sessions is not yet provided by OpenAI's preview. Disconnect the app from ChatGPT Settings if necessary.

The transfer command is implemented but a real transfer is unverified without your authorized credentials. It does not transfer your companion content; use your own secure database backup if you also want the same local content on the VM.

## Cloudflare and commercial/hosted use

Cloudflare Workers is a hosted deployment, not the documented local callback runtime or self-hosted VM transfer procedure. Plan mode is deliberately unavailable there. No public callback workaround, browser-cookie scraping, private ChatGPT endpoints, or borrowed Codex credentials are used.

For a paid or provider-hosted product, complete the [official client/approval process](https://developers.openai.com/siwc/request-client-id) or interest form linked from the overview. Obtain its registered redirect, client type/authentication contract, and plan-usage approval before implementing that hosted flow. Each user must authorize their own plan; one personal account must never fund multiple customers. This personal application is not a commercial multi-tenant deployment. Until approval, use No-AI or explicitly enabled separately billed API mode.
