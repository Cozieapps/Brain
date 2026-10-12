# Verification record

Executed in this workspace on 2026-10-12 with Node 24.19.0, TypeScript, SQLite, Chromium, Wrangler 4.149.0/workerd. No real third-party messages, bookings, purchases, AI requests, or public deployment occurred.

## Passed

- `npm ci --cache /workspace/.npm-cache`: repeatable installation from the lockfile, with verification left enabled.
- `npm run migrate`: migrations 1 and 2 applied. Repeating it reported the same versions without changing existing records.
- `npm run typecheck`: passed.
- `npm test`: **36 passed, 0 failed, 0 skipped** (27 domain/HTTP/privacy tests, 9 provider/OAuth tests).
- `npm run build`: production React assets built successfully. Vite reports upstream Zod pure-comment annotation notices; these do not fail the build. Vendor chunks separate React, validation and Temporal.
- `npm run test:browser`: **4 passed, 0 failed, 0 skipped** using real Chromium. Desktop capture → task → checkpoint → reload → resume, mobile guided start/capacity and all ten choices, return evidence and revoked edit permission, WCAG A/AA axe checks at 1280px and 390px. Keyboard modal escape/focus and absence of horizontal overflow are checked. No external browser requests occur on fresh No-AI use.
- `npm audit --omit=dev`: zero reported production dependency vulnerabilities at the time checked.
- `wrangler deploy --dry-run`: successful production bundle; `wrangler deploy --dry-run --env preview`: successful isolated preview bundle. Neither command publishes.
- Cloudflare local workerd runtime on port 8787: unauthenticated API returned 401; passphrase login returned 200; a real Chromium browser accepted the secure session and used the React UI; checkpoint create/read/resume returned 200; SQLite state survived a runtime restart; one due Durable Object alarm produced exactly one inbox notification; worker heartbeat was current; plan mode remained unavailable on this hosted target. Synthetic content was then deleted.
- Node application starts on loopback port 3000 with an empty personal content database and the reminder worker running.

## Acceptance coverage

Each workflow has a realistic success/recovery test in `tests/workflows.test.ts`. The suite exercises obstacle-specific starts/helpful memory, actual persisted checkpoint restoration after database close/reopen, returns/appointments/forms with evidence, dependency and deadline ranking, override/rest, DST-aware transitions, comeback/repair/drop, grounded delayed replies, accepted responsibility handoffs, user-controlled pauses, and capacity-dependent reminder load.

Additional tests cover lease recovery and deduplication across worker instances, quiet hours, temporary pause, time-zone changes, overdue recovery budget, optimistic versions, cyclic/dropped dependencies, profile isolation, forgotten/expired memory retrieval, full conversation export, forgetting during active inference, calendar UID deduplication and IANA time zones, untrusted attachments, CSRF/DNS rebinding, TLS/auth requirements, logout revocation, quota failures and continued No-AI availability.

Provider tests use mocks and test-generated keys. They verify PKCE/state/nonce, issued client handling, callback expiry/browser binding, identity audience/issuer/expiry checks, missing plan scopes, account separation, token rotation/serialized refresh, owner-only credential files, cancelled account-switch requests, separate plan/API payloads, terminal stream validation, split UTF-8/CRLF events and post-start quota failure. The code uses maintained `jose` verification rather than accepting decoded unsigned identity claims.

## Fixes made during verification

- A settings checkbox briefly reverted before its server response; it now updates immediately and reconciles with server state.
- Equal pause timestamps with differing ISO formatting could defer a due job; comparisons now use instants.
- Reminder intent is preserved separately from delivery deferrals, allowing quiet-hour/time-zone changes to be reevaluated.
- Calendar TZID parameters are used explicitly rather than silently taking the profile time zone.
- A forgotten memory could survive in an in-flight answer; content revisions now discard that answer.
- Dropping a prerequisite no longer satisfies the dependent task.
- Exports include full conversation history, beyond the bounded UI/model context window.
- SSE CRLF separators spanning network chunks are normalized correctly.
- Secondary text contrast was strengthened; both tested home layouts pass axe's WCAG A/AA checks.

## Not verified / intentionally unavailable

- **Live ChatGPT authorization and inference:** need the user's eligible installation/account and explicit plan consent. No real tokens were available. Manual check: follow `CHATGPT.md`, authorize, load account models, make one request, test reauthorization and sign-out, verify app usage in ChatGPT Settings.
- **Real self-hosted credential transfer:** helper implemented, no real credentials transferred. Follow the secure procedure in `CHATGPT.md`; the receiving VM preserves its own host ID.
- **Public Cloudflare deployment:** the user approved the GitHub source push to `main`. They must still authorize the connected Cloudflare build/account deployment and configure `BESIDE_PASSWORD`. Local workerd and dry-run bundles are verified; a real hosted URL is not claimed.
- **Hosted/commercial plan access:** requires official approval and an issued client contract. Cloudflare does not pretend to implement the OSS loopback flow as a public callback.
- **Separately billed API:** adapter and failure behavior tested with mocks. Live success needs an explicitly configured server key, user activation and billing limits.
- **Closed-browser push, live calendar/email and external submissions:** unavailable. The app labels these and uses calendar files, in-app reminders and user handoffs. Browser notifications and microphone capture depend on browser permissions; actual device delivery/recording was not exercised.
- **Platform snapshot publication/new-task restoration:** reusable environment instructions are saved separately; no platform publication or fresh-task restoration is claimed.

## Repeat a Cloudflare persistence check

Start the local Wrangler command from `CLOUDFLARE.md` using the synthetic passphrase `test-only-cloudflare-passphrase`. Then run:

```sh
node scripts/cloudflare-smoke.mjs create
# Wait for the next minute-level alarm; stop and restart the local Wrangler process.
node scripts/cloudflare-smoke.mjs verify
node scripts/cloudflare-smoke.mjs clean
```

The helper refuses to use a public URL and only accesses the local test runtime. Never use its fixture passphrase for a deployed installation.
