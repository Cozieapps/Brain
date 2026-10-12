// Uses only a local Wrangler runtime and an explicit synthetic test passphrase.
// Run after starting the documented local test runtime on port 8787.
const base = "http://127.0.0.1:8787";
const phase = process.argv[2] ?? "verify";
const headers = { "Content-Type": "application/json", "X-Beside": "1" };
const login = await fetch(base + "/api/login", {
  method: "POST",
  headers,
  body: JSON.stringify({ password: "test-only-cloudflare-passphrase" }),
});
if (!login.ok)
  throw Error(
    "Local test login failed; use the documented synthetic test passphrase.",
  );
headers.cookie = login.headers
  .getSetCookie()
  .map((x) => x.split(";")[0])
  .join("; ");
async function call(path, body) {
  const r = await fetch(base + "/api" + path, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error ?? "Request failed");
  return data;
}
if (phase === "create") {
  await call("/delete-all", { confirm: "DELETE" });
  await call("/settings", { quietEnabled: false, notificationBudget: 3 });
  await call("/tool", {
    name: "record.create",
    input: {
      kind: "checkpoint",
      title: "Cloudflare smoke test",
      data: {
        purpose: "Verify durable persistence",
        position: "at the runtime check",
        nextAction: "Resume after runtime restart",
      },
    },
  });
  await call("/tool", {
    name: "record.create",
    input: {
      kind: "pause",
      title: "Cloudflare alarm check",
      data: {
        type: "reply",
        item: "An unsent synthetic reply",
        reviewAt: new Date(Date.now() - 1000).toISOString(),
      },
    },
  });
  console.log(
    "Created a checkpoint and a due reminder. Verify after the next alarm and after restarting Wrangler.",
  );
} else if (phase === "clean") {
  await call("/delete-all", { confirm: "DELETE" });
  console.log("Synthetic test content removed.");
} else {
  const state = await call("/state");
  const result = await call("/tool", { name: "checkpoint.resume", input: {} });
  if (!result.message.includes("Resume after runtime restart"))
    throw Error("Checkpoint persistence check failed");
  if (state.notifications.length !== 1)
    throw Error(
      "Expected exactly one deduplicated alarm notification; found " +
        state.notifications.length,
    );
  if (!state.worker.online) throw Error("Worker heartbeat is stale");
  if (state.providers.plan.state !== "unavailable")
    throw Error("Hosted plan access must remain gated");
  console.log(
    "Cloudflare runtime verified: private session, durable checkpoint, one alarm notification, fresh heartbeat, hosted plan gate.",
  );
}
