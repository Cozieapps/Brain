# Implementation checkpoint

User goal: implement all ten workflows as one continuous companion, with fully functional No-AI mode, documented ChatGPT plan integration, and a Cloudflare test target. Existing checkout was empty and had no license. Public code publication and deployment require the user's approval under the brief.

- [x] Inspect repository and supplied brief.
- [x] Verify official OpenAI registration, scopes, inference, session, VM, preview and usage docs.
- [x] Shared React/TypeScript/Hono backend: local Node SQLite and Cloudflare SQLite Durable Objects.
- [x] Versioned migrations, full-text/approximate search, explicit profiles, task events and undo, privacy deletion/export.
- [x] All ten guided workflows, real stage/evidence transitions and success/recovery paths.
- [x] Durable jobs, deduplication, leases, attempts, cancellation, restart recovery, quiet hours, budget, capacity, inbox and browser notification controls.
- [x] Responsive companion UI, attachments/audio capture without transcription, calendar import/export, settings and permissions.
- [x] Official local OAuth registration with PKCE/state/nonce/signature validation, protected per-registration credentials, renewal and sign-out; account model discovery and separate streaming Responses adapters.
- [x] Eligible-installation gate for local plan access; clear unavailable state for hosted Cloudflare plan use pending official approval.
- [x] Explicit separately billed API mode and limits; no fallback or idle model requests.
- [x] Migrations, typecheck, production build, 36 automated tests, 4 browser/accessibility tests, real local Cloudflare runtime and restart/alarm checks.
- [x] Setup, Cloudflare, ChatGPT/self-hosting, privacy and verification guides; new MIT license (no existing license was changed).

Remaining external steps, not implementation claims:

1. User approved committing and pushing the source to `Cozieapps/Brain` on `main`. Verify the remote branch before starting a connected Cloudflare build; source publication does not itself authorize a public deployment.
2. User authorizes Cloudflare deployment and sets a strong `BESIDE_PASSWORD` runtime secret. No Cloudflare account credential was provided.
3. User establishes OSS/private-client eligibility and authorizes an eligible ChatGPT account to verify live local plan access. Hosted/commercial plan support remains gated pending the official approval and issued contract.
4. Optional: configure a separately billed API key and explicitly activate that mode. Optional live email/calendar, push delivery and external tools are not connected; file calendars and manual handoffs already work.

Exact next work if resumed: inspect current Git/file state, preserve existing content, and act on the user's publishing/account authorization. Do not redo implementation or silently publish. Read `docs/VERIFICATION.md` for passed checks and manual checks. Use this isolated existing checkout; do not create a worktree unless requested.
