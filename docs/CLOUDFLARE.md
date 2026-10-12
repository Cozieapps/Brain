# Test Beside on Cloudflare

Use a **Worker**, not an empty static deployment. The Worker serves the built React assets and routes `/api/*` to a SQLite-backed Durable Object. Durable Object alarms provide persistent reminders. No SQL/database IDs need to be pasted into the config.

## Your connected-repository screen

1. Connect `Cozieapps/Brain` and select **main**, the branch approved for publishing this application's source. Ensure the implementation commit is present before starting the Cloudflare build.
2. Project name: **brain**. Root directory: repository root. Build command: **`npm run build`**. Deploy command: **`npx wrangler deploy`**. Build environment variable: **`NODE_VERSION=24`**. Cloudflare's repository build installs locked npm dependencies. If you disable its install step, use `npm ci && npm run build`.
3. Disable preview builds for the initial deployment. `wrangler.jsonc` applies the initial SQLite Durable Object namespace migration. For subsequent version uploads, use **`npx wrangler versions upload`**; `npx wrangler preview` is not the configured preview command.
4. In Worker → Settings → Variables and Secrets, add **BESIDE_PASSWORD** as a **secret**, at least 16 characters, using a strong unique passphrase. Redeploy if the dashboard requests it. The app initially shows a setup screen and its API returns 503 until a valid secret exists. Never put this value in Git, a build command, or chat. Optionally enable Cloudflare Access in front of it.
5. Open the HTTPS URL provided by Cloudflare and enter your passphrase. The personal database starts empty. Test a capture, task, checkpoint, calendar, and reminder.
6. This uses your Cloudflare account. You must authorize the GitHub repository connection/build, configure the secret, and approve deployment. No Cloudflare credentials were available or used for a real deployment during implementation.

## Isolated previews

A preview that uses production Durable Object bindings shares production content. Do not test against that data.

The `preview` environment in `wrangler.jsonc` uses the separate Worker name `brain-preview` and its own `COMPANION` namespace. To initialize it:

```sh
npm run build
npx wrangler deploy --env preview
npx wrangler secret put BESIDE_PASSWORD --env preview
```

After that environment's first migration, use `npx wrangler versions upload --env preview` for preview versions. Configure Cloudflare preview builds with that command, not an unqualified upload that reuses production. Test with synthetic data only. Alarms may execute the currently deployed Worker version; version-only previews do not independently validate scheduled code deployment.

## Local Cloudflare runtime verification

```sh
npm run build
npx wrangler dev --local --ip 127.0.0.1 --port 8787 --var BESIDE_PASSWORD:local-test-passphrase-only
```

The final value above is explicitly a local test fixture, never a real deployment secret. Browse the local runtime and sign in with it. State is retained under `.wrangler/state`, separate from Node's `.data` database. `npx wrangler deploy --dry-run` builds/bundles without publishing.

In restricted cloud workspaces, Wrangler's config/log directories can need relocation:

```sh
WRANGLER_LOG_PATH=/tmp/beside-wrangler.log \
XDG_CONFIG_HOME=/workspace/.config WRANGLER_SEND_METRICS=false \
npx wrangler deploy --dry-run
```

These environment settings relocate CLI files; they do not bypass networking or TLS checks.

## Optional AI

ChatGPT-plan mode is unavailable on this hosted target pending the official hosted-app approval and implementation against the issued contract. The local/self-hosted plan adapter uses the documented loopback flow; see [ChatGPT integration](CHATGPT.md).

To use a separately billed API account instead, add `BESIDE_API_KEY` with Wrangler secrets or the Cloudflare secret UI, optionally set `BESIDE_API_MODEL`, then explicitly allow AI and activate API mode in Beside Preferences. Do not put a provider key in frontend variables or `wrangler.jsonc`.

## Operations and costs

- Cloudflare Workers/SQLite Durable Objects usage, storage and minute-level alarms can incur charges or reach free-tier limits. Consult current account limits before enabling a public deployment. This task made no purchase.
- One installation is for one person. Its passphrase grants access to that person's content. It is not tenant authentication. Use separate Workers for separate users unless you first implement a multi-tenant account system.
- Live processes are not a deployment artifact. Durable alarms restart work; the local Node app must run to process jobs. The inbox reports last check time. Browser notifications require an open page; closed-browser push is unavailable.
- The API requires same-origin JSON requests, rejects cross-site origins, uses Secure/HttpOnly/SameSite session cookies in production, rate-limits passphrase attempts, and revokes application sessions on logout.
- Migrations are embedded in the server and versioned under `migrations/`. For backups/deletion, review [privacy](PRIVACY.md), including Cloudflare's platform retention policies.
