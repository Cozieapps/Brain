import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { sqlite } from "../src/server/sqlite";
import { Store } from "../src/server/store";
import { executeTool as execute } from "../src/server/tools";
import { continuity, getThreads, modelContext } from "../src/server/continuity";
import { tick } from "../src/server/jobs";
import { makeApp } from "../src/server/app";
import initialMigration from "../migrations/001_initial";
import reminderMigration from "../migrations/002_reminder_intent";
let db: ReturnType<typeof sqlite>, store: Store, now: Date;
beforeEach(() => {
  db = sqlite();
  now = new Date("2026-10-12T14:00:00Z");
  store = new Store(db, "personal", () => now);
});
afterEach(() => db.close());
function begin(flow: string, recordId?: string) {
  return execute(store, "conversation.begin", { flow, recordId });
}
function answer(value: string) {
  const t = getThreads(store).find((t) => t.status === "active")!;
  return execute(store, "conversation.answer", {
    id: t.id,
    version: t.version,
    value,
  });
}
function returnTask() {
  begin("return");
  answer("Return shoes");
  answer("Order 123; unworn; bought last week");
  return answer("__skip__").records!.find((r) => r.kind === "task")!;
}
function post(app: ReturnType<typeof makeApp>, path: string, data: any) {
  return app.request("http://localhost/api" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Beside": "1" },
    body: JSON.stringify(data),
  });
}
describe("continuous companion work", () => {
  it("upgrades existing version-two data without replacing records", () => {
    const legacy = sqlite();
    legacy.exec(initialMigration);
    legacy.exec(reminderMigration);
    legacy.run(
      "INSERT INTO profiles(id,settings) VALUES (?,?)",
      "personal",
      "{}",
    );
    legacy.run(
      "INSERT INTO records(id,profile_id,kind,title,status,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      "existing",
      "personal",
      "capture",
      "Keep this",
      "active",
      JSON.stringify({ body: "Existing private note" }),
      now.toISOString(),
      now.toISOString(),
    );
    const upgraded = new Store(legacy);
    expect(upgraded.get("existing").data.body).toBe("Existing private note");
    new Store(legacy);
    expect(
      legacy.all("SELECT * FROM schema_migrations WHERE version=3"),
    ).toHaveLength(1);
    expect(getThreads(upgraded)).toHaveLength(0);
    legacy.close();
  });
  it("closing a responsibility elsewhere retires its unfinished conversation", () => {
    const task = returnTask();
    begin("followup", task.id);
    execute(store, "record.update", {
      id: task.id,
      version: task.version,
      status: "submitted",
      evidence: "Receipt 77",
    });
    const submitted = store.get(task.id);
    execute(store, "record.update", {
      id: task.id,
      version: submitted.version,
      status: "confirmed",
      evidence: "Refund credited, reference 99",
    });
    expect(getThreads(store)).toHaveLength(0);
    expect(() => begin("followup", task.id)).toThrow(/already closed/);
  });
  it("an interrupted conversation survives closing the database and resumes the actual question", () => {
    const dir = mkdtempSync(tmpdir() + "/beside-threads-");
    let disk = sqlite(dir + "/test.sqlite");
    let s = new Store(disk);
    execute(s, "conversation.begin", { flow: "return" });
    let t = getThreads(s)[0];
    execute(s, "conversation.answer", {
      id: t.id,
      version: t.version,
      value: "Return my shoes",
    });
    disk.close();
    disk = sqlite(dir + "/test.sqlite");
    s = new Store(disk);
    t = getThreads(s)[0];
    expect(t.data.title).toBe("Return my shoes");
    expect(t.question?.key).toBe("references");
    execute(s, "conversation.answer", {
      id: t.id,
      version: t.version,
      value: "Order 42",
    });
    t = getThreads(s)[0];
    expect(t.question?.key).toBe("deadline");
    disk.close();
    rmSync(dir, { recursive: true });
  });
  it("return preparation, user submission, real follow-up, and confirmation carry one responsibility through", () => {
    const r = returnTask();
    expect(r.status).toBe("prepared");
    expect(store.list("draft")[0].data.body).toContain("Order 123");
    begin("followup", r.id);
    answer("submitted");
    answer("I submitted the return; receipt 444");
    answer("The shop");
    expect(store.get(r.id).status).toBe("waiting");
    expect(db.all("SELECT * FROM jobs WHERE status='pending'")).toHaveLength(1);
    store.saveSettings({ ...store.settings(), quietEnabled: false });
    now = new Date("2026-10-15T15:00:00Z");
    tick(store);
    tick(store);
    expect(continuity(store).notifications).toHaveLength(1);
    expect(continuity(store).items[0].record.id).toBe(r.id);
    begin("followup", r.id);
    answer("confirmed");
    answer("Refund credited, bank reference 888");
    expect(store.get(r.id).status).toBe("confirmed");
    expect(store.list("task")).toHaveLength(1);
    expect(continuity(store).notifications).toHaveLength(0);
    expect(continuity(store).items).toHaveLength(0);
  });
  it("duplicate and concurrent answers cannot create duplicate responsibilities or drafts", () => {
    begin("return");
    answer("Shoes");
    answer("__skip__");
    const t = getThreads(store)[0];
    const payload = { id: t.id, version: t.version, value: "__skip__" };
    execute(store, "conversation.answer", payload);
    expect(() => execute(store, "conversation.answer", payload)).toThrow(
      /changed/,
    );
    expect(store.list("task")).toHaveLength(1);
    expect(store.list("draft")).toHaveLength(1);
  });
  it("parking one conversation to start another retains both, and back corrects stored answers", () => {
    begin("person");
    answer("Alex");
    let first = getThreads(store)[0];
    begin("checkpoint");
    answer("Passport form");
    expect(getThreads(store)).toHaveLength(2);
    execute(store, "conversation.resume", { id: first.id });
    first = getThreads(store).find((t) => t.status === "active")!;
    expect(first.data.title).toBe("Alex");
    execute(store, "conversation.back", {
      id: first.id,
      version: first.version,
    });
    answer("Alec");
    expect(
      getThreads(store).find((t) => t.status === "active")?.data.title,
    ).toBe("Alec");
  });
  it("ambiguous and daylight-saving dates never become real deadlines; the pinned zone is explicit", () => {
    begin("return");
    answer("Shoes");
    answer("__skip__");
    expect(() => answer("next Friday")).toThrow();
    expect(() => answer("2026-11-01T01:30")).toThrow();
    expect(store.list("task")).toHaveLength(0);
    expect(getThreads(store)[0].question?.key).toBe("deadline");
    store.saveSettings({ ...store.settings(), timezone: "Europe/Paris" });
    expect(getThreads(store)[0].data.timezone).toBe("America/New_York");
    const r = answer("2026-10-20T10:00").records!.find(
      (r) => r.kind === "task",
    )!;
    expect(Date.parse(r.data.deadline)).toBe(
      Date.parse("2026-10-20T14:00:00Z"),
    );
  });
  it("stale record changes stop a conversation applying an outdated update", () => {
    const r = returnTask();
    begin("followup", r.id);
    answer("submitted");
    answer("Receipt 4");
    execute(store, "record.update", {
      id: r.id,
      version: r.version,
      data: { references: "New details" },
    });
    expect(() => answer("Shop")).toThrow(/changed/);
    const thread = getThreads(store)[0];
    execute(store, "conversation.resume", { id: thread.id });
    expect(getThreads(store)[0].step).toBe(0);
    expect(store.get(r.id).status).toBe("prepared");
  });
  it("revoked internal permission, wrong profiles and model callers cannot mutate conversations", () => {
    begin("capture");
    const t = getThreads(store)[0];
    const other = new Store(db, "other");
    expect(() => execute(other, "conversation.resume", { id: t.id })).toThrow(
      /no longer/,
    );
    expect(() =>
      execute(
        store,
        "conversation.answer",
        { id: t.id, version: t.version, value: "Private" },
        "model",
      ),
    ).toThrow(/review/);
    store.saveSettings({
      ...store.settings(),
      permissions: { internal: false, ai: false },
    });
    expect(() => answer("Private")).toThrow(/permission/);
    expect(store.list()).toHaveLength(0);
  });
  it("forgetting context clears partial conversations and pending model suggestions, including exports", () => {
    const memory = execute(store, "record.create", {
      kind: "memory",
      title: "Private",
      data: { body: "Secret context" },
    }).records![0];
    begin("checkpoint");
    answer("Secret context");
    db.run(
      "INSERT INTO companion_proposals VALUES (?,?,?,?)",
      "p",
      store.profileId,
      JSON.stringify({
        name: "record.create",
        input: {
          kind: "capture",
          title: "Secret context",
          data: { body: "Secret context" },
        },
      }),
      store.now(),
    );
    expect(store.export().conversations).toHaveLength(1);
    store.forget(memory.id);
    expect(getThreads(store)).toHaveLength(0);
    expect(store.export().proposals).toHaveLength(0);
    expect(JSON.stringify(modelContext(store, "Secret context"))).not.toContain(
      "Secret context",
    );
  });
  it.each([
    ["start", ["Send one email", "emotional"], "task"],
    ["capture", ["Pick up the prescription"], "capture"],
    [
      "checkpoint",
      ["Passport", "Section two", "Upload a photo", "Use the official form"],
      "checkpoint",
    ],
    [
      "appointment",
      ["Dentist", "Available Tuesday mornings", "__skip__"],
      "task",
    ],
    ["form", ["Grant application", "Reference 34", "__skip__"], "task"],
    [
      "person",
      ["Alec", "New job", "Ask about their first week", "2026-10-20T10:00"],
      "person",
    ],
    [
      "handoff",
      [
        "Book repair",
        "Sam",
        "A confirmed booking",
        "Number in contacts",
        "__skip__",
      ],
      "handoff",
    ],
    [
      "pause",
      [
        "commitment",
        "Join committee",
        "Keep Friday free",
        "__skip__",
        "2026-10-20T10:00",
      ],
      "pause",
    ],
    [
      "transition",
      [
        "Dental visit",
        "Writing section two",
        "Finish paragraph",
        "2026-10-20T10:00",
        "10",
        "5",
        "20",
        "10",
      ],
      "transition",
    ],
  ])(
    "%s completes with persisted useful state through one question at a time",
    (flow, answers, kind) => {
      begin(flow as string);
      for (const value of answers as string[]) answer(value);
      expect(getThreads(store)).toHaveLength(0);
      expect(store.list(kind as any)).toHaveLength(1);
      if (flow === "handoff")
        expect(store.list("handoff")[0].status).toBe("proposed");
      if (flow === "transition")
        expect(store.list("checkpoint")).toHaveLength(1);
    },
  );
  it("No-AI HTTP conversations make zero provider requests and survive app recreation", async () => {
    const network = vi.fn();
    let app = makeApp(db, { local: true, network });
    await post(app, "/tool", {
      name: "conversation.begin",
      input: { flow: "capture" },
    });
    app = makeApp(db, { local: true, network });
    const state: any = await (
      await app.request("http://localhost/api/state")
    ).json();
    const t = state.continuity.threads[0];
    const response = await post(app, "/tool", {
      name: "conversation.answer",
      input: { id: t.id, version: t.version, value: "Hold this thought" },
    });
    expect(response.status).toBe(200);
    expect(store.list("capture")[0].data.body).toBe("Hold this thought");
    expect(network).not.toHaveBeenCalled();
  });
  it("AI sees bounded ongoing context, proposes a persistent conversation, and review applies once", async () => {
    const existing = returnTask();
    const suggestion = `We already have your shoe return saved. Let's pick it up.\n\`\`\`json\n${JSON.stringify({ name: "conversation.begin", input: { flow: "followup", recordId: existing.id } })}\n\`\`\``;
    const network = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.instructions).toContain(existing.id);
      expect(body.instructions).toContain("Order 123");
      return new Response(
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: suggestion })}\n\ndata: ${JSON.stringify({ type: "response.completed" })}\n\n`,
        { headers: { "Content-Type": "text/event-stream" } },
      );
    });
    const app = makeApp(db, { local: true, apiKey: "test-only", network });
    await post(app, "/settings", {
      mode: "api",
      permissions: { internal: true, ai: true },
    });
    const chat = await post(app, "/chat", {
      message: "Can we pick up my return?",
    });
    expect(chat.status).toBe(200);
    const state: any = await (
      await makeApp(db, { local: true }).request("http://localhost/api/state")
    ).json();
    expect(state.proposals).toHaveLength(1);
    expect(getThreads(store)).toHaveLength(0);
    const p = state.proposals[0];
    expect(
      (
        await post(app, "/tool", {
          name: "proposal.apply",
          input: { id: p.id },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(app, "/tool", {
          name: "proposal.apply",
          input: { id: p.id },
        })
      ).status,
    ).toBe(400);
    expect(getThreads(store)[0].recordId).toBe(existing.id);
    expect(store.list("task")).toHaveLength(1);
    expect(network).toHaveBeenCalledTimes(1);
  });
});
