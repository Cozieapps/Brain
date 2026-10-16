# Beside

A private, practical ADHD companion: one conversation, ten connected workflows, and a fully functional No-AI mode. Built with React, TypeScript, Hono, SQLite/FTS5, and durable reminders. Runs locally on Node 24 or on Cloudflare Workers with SQLite Durable Objects.

**No credentials are needed for local No-AI use.** Real data starts empty. No demo data is inserted. The application does not diagnose, adjust medication, monitor relationships, or send anything externally.

## On-device voice companion (no internet)

`/offline.html` is a separate, fully on-device app for tablets: you type, and it answers out loud with a natural neural voice (Kokoro). It runs Gemma 4 or Qwen 3.5/3 in the browser, has ADHD tools (tasks with tiny steps, focus timer with spoken check-ins, reminders, energy check-ins, brain dump), and works with Wi-Fi off after a one-time download. See [the on-device guide](docs/OFFLINE.md), including which model suits a Galaxy Tab S9 FE.

## Run locally

Requires Node 24+ and npm.

```sh
npm ci
npm run migrate
npm run build
npm start
```

Open `http://127.0.0.1:3000`. The server binds to loopback and includes the reminder worker. The application has been tested on Node 24.19.0. `npm run dev` restarts the backend when source files change; run `npx vite --host 127.0.0.1` in another terminal for client hot reload at port 5173. OAuth sign-in must use port 3000 at 127.0.0.1, not the Vite proxy.

`npm run worker` runs a separate reminder worker against the same database if you prefer separate process supervision. Leases/transactions and unique keys prevent duplicate inbox entries when both are running. No worker model calls occur. `npm run migrate` is idempotent; servers also apply migrations automatically.

Configuration: copy `.env.example` to `.env` only when needed. Node launch commands load it. Data is kept in `.data/beside.sqlite`; provider credentials are separately protected in `.data/provider/credentials.json`. Both are ignored by Git. Set `BESIDE_DATA_DIR` to use another private directory. Stop before copying raw SQLite files, or use SQLite's backup facility. Application exports include all current profile records and attachments and never provider credentials.

## Cloudflare setup — the screen in your screenshot

See [the exact deployment steps](docs/CLOUDFLARE.md).

| Field                   | Value                          |
| ----------------------- | ------------------------------ |
| Project / Worker name   | `brain`                        |
| Root directory          | repository root (`/`)          |
| Build command           | `npm run build`                |
| Deploy command          | `npx wrangler deploy`          |
| Preview/version command | `npx wrangler versions upload` |
| Build variable          | `NODE_VERSION=24`              |

Turn **Preview builds off for the first deployment**. The first Durable Object migration must be deployed before uploading preview versions. Never connect a public preview to your personal production database. The included named preview environment uses a distinct Worker and Durable Object namespace; see the deployment guide.

Set **`BESIDE_PASSWORD` as a runtime secret with at least 16 characters**. The deployed API refuses access until this is set. No API key, D1 setup, R2 bucket, or external database is required. SQLite Durable Objects are configured by `wrangler.jsonc`. The password protects a **single person's installation**, not a multi-user SaaS. Keep TLS and optionally add Cloudflare Access.

The user approved publishing the application source to `Cozieapps/Brain` on `main`. Select that branch for the connected Cloudflare build. Public Cloudflare deployment still requires account authorization and configuration. Publishing this MIT-licensed source or running an approved private client is also separate from ChatGPT account eligibility.

## Three honest modes

- **No-AI:** all guided workflows, text capture, tasks, evidence, drafts, people, handoffs, pauses, capacity, memory search, calendar import/export, and notifications. Zero model/embedding/transcription calls. Free text is saved as a capture; only explicitly documented phrases activate guided commands. It is not general language understanding.
- **ChatGPT plan:** the documented personal open-source loopback flow is implemented for the local/self-hosted edition. It is gated by installation eligibility, then each user's consent. See [ChatGPT setup and VM transfer](docs/CHATGPT.md). It uses the user's existing plan allowance. Live account authorization has **not** been exercised. Cloudflare plan access is **unavailable**: a hosted app needs the official approval and issued hosted-client contract. No public callback workaround is used.
- **API:** optional, separately billed, off by default. Configure a server-side `BESIDE_API_KEY`, allow AI in Preferences, then explicitly enable API mode. `BESIDE_API_MODEL` defaults to `gpt-4.1-mini`. There is never automatic fallback from plan to API. Configure provider-side spending limits as well as Beside's request caps.

## What works

| Workflow           | Useful path                                                                                 | Recovery                                            |
| ------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Help me start      | Choose an obstacle; save one concrete step and helpful approaches                           | Reduce, pause, resume, undo                         |
| Hold my place      | Capture → task → checkpoint → resume after restart                                          | Approximate search, edit, forget                    |
| Carry it through   | Return/refund, appointment request, or form → draft → user submission → waiting → confirmed | Evidence required, reschedule, retry, undo          |
| What matters now?  | Rank real deadlines, consequences, dependencies, priority and capacity                      | Override, rest, pause or deliberately drop          |
| Help me transition | Saved checkpoint + user travel estimate → backward schedule                                 | Recalculate; explicit arrival confirmation          |
| Help me come back  | Review active/expired responsibilities and recorded outcomes                                | Repair a next action, reschedule or drop explicitly |
| Remember my people | Save selected context → editable message → user handoff                                     | Delayed reply template; change follow-up            |
| Share the load     | Record outcome, owner, date and information → proposed → accepted → completed               | Agreement and evidence required; pause/undo         |
| Give me a pause    | Save purchase, commitment or reply + constraint + review date                               | Reschedule, proceed freely, or let go               |
| Work with today    | Current capacity changes recommendations and reminder budget                                | Current report overrides prior settings             |

The UI, guided flows and reviewed AI proposals use the same schema-validated tool registry. Models have no shell, computer control, or external-sending tools. AI responses do not directly execute mutations; proposals are reviewed as concrete typed actions. Memory is retrieved before inference and distinguishes user statements, suggestions and inferences. No full-history or embedding calls.

## Continuity between conversations

Start from the companion's quick actions or “A few more ways I can help.” Guided conversations ask for one detail at a time and save each answer. Closing the page or restarting the server preserves the next question. “Save this spot” lets you change topics; “Keeping track for you” brings the unfinished conversation back. You can correct your last answer before carrying on.

Returns, appointment requests, and applications create an ongoing responsibility and a linked, unsent draft. “Pick this up” continues that same item: record your actual submission, name the waiting party, and later supply outcome evidence. A persisted waiting update schedules a check after three days, subject to reminder preferences. The companion shows due follow-ups, saved drafts, scheduled checks, and actual activity in its main view. It cannot independently inspect a shop's reply or bank refund.

When AI is enabled, requests include bounded relevant saved records, ongoing responsibilities, and checkpoints. The model can suggest starting or continuing these conversations. Suggestions survive reloads, require a concrete review, and can be applied only once. Routine guided progress and reminders make no model requests. This does not add Dot's computer, connected apps, or proprietary runtime.

## Notifications, files and privacy

- Durable jobs are persisted, deduplicated, leased, retried at most three times, cancellable and reconciled on restart. Unread reminders suppress duplicate nudges; capacity, quiet hours, monitoring choices, pause, urgency exceptions and daily budgets apply.
- Local work pauses when the server is off. Cloudflare Durable Object alarms run reminders on the hosted runtime. The inbox shows the last worker check. Minute-level alarms have hosting costs/limits.
- Browser notifications require permission and an open page. **Closed-browser push is not implemented.** No service worker is claimed to run continuously.
- Attach files up to 3 MB, at most 100 per profile. Plain text/Markdown, PDF, common images and supported audio types are saved as downloads. They are not automatically read or sent to AI. Optional microphone recording is capability-detected, limited to 60 seconds, saved without transcription; text is always available.
- Timed `.ics` appointments import/export locally, with duplicate UID detection. Recurrence, all-day entries, and ambiguous local times are rejected for explicit clarification instead of guessed.
- [Privacy, permissions and operational limits](docs/PRIVACY.md).

## Verify

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
npx wrangler deploy --dry-run
```

Browser tests use `/usr/bin/chromium` by default on this cloud machine. Elsewhere set `BESIDE_BROWSER_PATH` to an installed Chromium or use `npx playwright install chromium` and set the executable path. They run a separate database under `/tmp/beside-browser-tests`, never real external actions.

See [verification evidence and manual checks](docs/VERIFICATION.md). Source is MIT licensed; no pre-existing license was present or changed.
