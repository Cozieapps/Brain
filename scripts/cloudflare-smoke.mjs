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
} else if (phase === "conversation-create") {
  await call("/tool", {
    name: "conversation.begin",
    input: { flow: "return" },
  });
  const state = await call("/state");
  const t = state.continuity.threads.find((t) => t.status === "active");
  await call("/tool", {
    name: "conversation.answer",
    input: {
      id: t.id,
      version: t.version,
      value: "Synthetic continuity return",
    },
  });
  console.log(
    "Saved the first answer. Restart the local Worker, then run conversation-verify.",
  );
} else if (phase === "conversation-verify") {
  let state = await call("/state");
  let t = state.continuity.threads.find((t) => t.status === "active");
  if (
    t?.data.title !== "Synthetic continuity return" ||
    t.question.key !== "references"
  )
    throw Error("Interrupted conversation was not restored");
  await call("/tool", {
    name: "conversation.answer",
    input: { id: t.id, version: t.version, value: "Synthetic order 123" },
  });
  state = await call("/state");
  t = state.continuity.threads.find((t) => t.status === "active");
  await call("/tool", {
    name: "conversation.answer",
    input: { id: t.id, version: t.version, value: "__skip__" },
  });
  state = await call("/state");
  const task = state.records.find(
    (r) => r.kind === "task" && r.title === "Synthetic continuity return",
  );
  if (
    !task ||
    task.status !== "prepared" ||
    !state.records.some((r) => r.kind === "draft" && r.data.taskId === task.id)
  )
    throw Error(
      "Conversation did not carry through to a responsibility and draft",
    );
  console.log(
    "Worker restart retained the question and answers; continuing created one responsibility and linked draft.",
  );
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
