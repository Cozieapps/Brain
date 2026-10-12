import type { Store } from "./store";
import type { RecordItem, ToolName, ToolResult } from "../shared/schema";
import {
  flowLabels,
  type Flow,
  type Question,
  type Thread,
} from "../shared/continuity";
import { localToInstant } from "../shared/time";

type Run = (name: ToolName, input: unknown) => ToolResult;
const choice = (value: string, label: string) => ({ value, label });
const title: Question = {
  key: "title",
  prompt: "What would you like me to help you carry?",
  maxLength: 240,
};
const details: Question = {
  key: "references",
  prompt: "What do you already know or have handy?",
  optional: true,
  hint: "A note, order number, link, or missing information. You can add more later.",
  maxLength: 4000,
};
const deadline: Question = {
  key: "deadline",
  prompt: "Is there a real deadline for this?",
  type: "datetime-local",
  optional: true,
  hint: "Only add a confirmed deadline. Skip if you are unsure; I will not guess one.",
};
const nextAction: Question = {
  key: "nextAction",
  prompt: "What is the very next thing to do when you come back?",
  maxLength: 1000,
};

function questions(store: Store, t: Thread): Question[] {
  const d = t.data;
  switch (t.flow) {
    case "start":
      return [
        { ...title, prompt: "What are you trying to start?" },
        {
          key: "obstacle",
          prompt: "What would help me meet you where you are?",
          choices: [
            choice("unclear", "I don't know where to begin"),
            choice("big", "It feels too big"),
            choice("emotional", "It feels difficult"),
            choice("low", "I have very little energy"),
          ],
          optional: true,
        },
      ];
    case "capture":
      return [
        {
          key: "body",
          prompt: "What would you like me to hold onto?",
          hint: "A thought, a link, or a note. It doesn't need organizing.",
        },
      ];
    case "checkpoint":
      return [
        { ...title, prompt: "What are you working on?" },
        { key: "position", prompt: "Where are you leaving off?" },
        nextAction,
        {
          key: "references",
          prompt: "Any decisions or references to keep with your place?",
          optional: true,
          maxLength: 4000,
        },
      ];
    case "return":
    case "appointment":
    case "form":
      return [
        {
          ...title,
          prompt:
            t.flow === "return"
              ? "What needs returning?"
              : t.flow === "appointment"
                ? "What appointment do you need to arrange?"
                : "What application or form are we carrying through?",
        },
        details,
        deadline,
      ];
    case "person":
      return [
        { ...title, prompt: "Who would you like to keep in mind?" },
        {
          key: "context",
          prompt: "What would you like me to remember about them?",
          maxLength: 3000,
        },
        {
          key: "followUp",
          prompt: "Is there something you want to say or follow up on?",
          optional: true,
          maxLength: 1000,
        },
        {
          key: "followUpAt",
          prompt: "Would you like a reminder to reach out?",
          type: "datetime-local",
          optional: true,
        },
      ];
    case "handoff":
      return [
        { ...title, prompt: "What responsibility would you like to share?" },
        {
          key: "owner",
          prompt: "Who are you proposing takes it on?",
          maxLength: 240,
        },
        { key: "outcome", prompt: "What would a completed handoff look like?" },
        {
          key: "information",
          prompt: "What information will they need?",
          optional: true,
          maxLength: 4000,
        },
        deadline,
      ];
    case "pause":
      return [
        {
          key: "type",
          prompt: "What would you like a little space before?",
          choices: [
            choice("purchase", "A purchase"),
            choice("commitment", "A commitment"),
            choice("reply", "A reply"),
          ],
        },
        { ...title, prompt: "What would you like to set aside?" },
        {
          key: "constraint",
          prompt: "What would you like to keep in mind when you revisit it?",
          optional: true,
          maxLength: 1000,
        },
        ...(d.type === "commitment"
          ? [
              {
                key: "displaces",
                prompt: "Would this take time from an existing responsibility?",
                optional: true,
                choices: store
                  .list("task")
                  .filter(
                    (r) =>
                      !["completed", "confirmed", "dropped"].includes(r.status),
                  )
                  .slice(0, 8)
                  .map((r) => choice(r.id, r.title)),
              },
            ]
          : []),
        {
          key: "reviewAt",
          prompt: "When would you like to revisit it?",
          type: "datetime-local",
        },
      ];
    case "transition":
      return [
        { ...title, prompt: "What do you need to be ready for?" },
        {
          key: "position",
          prompt: "Before we switch: where are you leaving your current work?",
        },
        nextAction,
        {
          key: "commitmentAt",
          prompt: "What time does your commitment start?",
          type: "datetime-local",
        },
        {
          key: "preparation",
          prompt: "How many minutes do you need to get ready?",
          type: "number",
        },
        {
          key: "windDown",
          prompt: "How many minutes to wind down what you are doing?",
          type: "number",
        },
        {
          key: "travel",
          prompt: "How many minutes do you estimate for travel?",
          type: "number",
          hint: "Use your own estimate, including zero for an online commitment.",
        },
        {
          key: "buffer",
          prompt: "How many extra minutes would give you some room?",
          type: "number",
        },
      ];
    case "followup": {
      const r = store.get(t.recordId!);
      const formal = r.data.workflow !== "general";
      return [
        {
          key: "change",
          prompt: `Where are we with “${r.title}”?`,
          choices: [
            ...(formal && !["waiting", "submitted"].includes(r.status)
              ? [choice("submitted", "I've submitted it myself")]
              : []),
            ...(formal
              ? ["submitted", "waiting"].includes(r.status)
                ? [
                    choice("waiting", "Still waiting"),
                    choice("confirmed", "I have the confirmed outcome"),
                  ]
                : []
              : [choice("completed", "I've finished this")]),
            choice("next", "The next step has changed"),
            choice("stuck", "I'm stuck on it"),
            choice("paused", "Set it aside for now"),
          ],
        },
        ...(["submitted", "confirmed", "completed"].includes(d.change)
          ? [
              {
                key: "evidence",
                prompt:
                  d.change === "submitted"
                    ? "What did you submit, and what receipt or evidence did you get?"
                    : "What happened that confirms it is finished?",
                maxLength: 3000,
              },
            ]
          : []),
        ...(["submitted", "waiting"].includes(d.change)
          ? [
              {
                key: "waitingOn",
                prompt: "Who or what are we waiting for?",
                maxLength: 240,
              },
            ]
          : []),
        ...(d.change === "next" ? [nextAction] : []),
        ...(d.change === "stuck"
          ? [
              {
                key: "obstacle",
                prompt: "What is getting in the way?",
                choices: [
                  choice("unclear", "Unclear"),
                  choice("big", "Too big"),
                  choice("emotional", "Difficult feelings"),
                  choice("low", "Low energy"),
                ],
              },
            ]
          : []),
      ];
    }
  }
}
function row(store: Store, r: any): Thread {
  const t: Thread = {
    id: r.id,
    flow: r.flow,
    step: r.step,
    version: r.version,
    data: JSON.parse(r.data),
    status: r.status,
    recordId: r.record_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    question: null,
  };
  t.question =
    t.status === "finished" ? null : (questions(store, t)[t.step] ?? null);
  return t;
}
export function getThreads(store: Store): Thread[] {
  return store.db
    .all(
      "SELECT * FROM companion_threads WHERE profile_id=? AND status!='finished' ORDER BY status='active' DESC,updated_at DESC LIMIT 20",
      store.profileId,
    )
    .map((r) => row(store, r));
}
function get(store: Store, id: string): Thread {
  const r = store.db.all(
    "SELECT * FROM companion_threads WHERE id=? AND profile_id=?",
    id,
    store.profileId,
  )[0];
  if (!r) throw Error("This saved conversation is no longer available.");
  return row(store, r);
}
function result(t: Thread): ToolResult {
  return {
    message: t.question?.prompt ?? "Your progress is saved.",
    action: "conversation",
  };
}
export function conversation(
  store: Store,
  operation: string,
  args: any,
  run: Run,
): ToolResult {
  if (operation === "begin") {
    if (args.recordId) {
      const r = store.get(args.recordId);
      if (args.flow !== "followup" || r.kind !== "task")
        throw Error("Choose a responsibility to continue.");
      if (["confirmed", "completed", "dropped"].includes(r.status))
        throw Error(
          "This responsibility is already closed. Use its history to reopen it if needed.",
        );
      const saved = store.db.all(
        "SELECT id FROM companion_threads WHERE profile_id=? AND record_id=? AND status!='finished' LIMIT 1",
        store.profileId,
        r.id,
      )[0];
      if (saved) return conversation(store, "resume", { id: saved.id }, run);
    } else if (args.flow === "followup")
      throw Error("Choose the responsibility you want to continue.");
    const old = getThreads(store).find((t) => t.status === "active");
    if (old && old.flow === args.flow && !args.recordId && !args.title)
      return result(old);
    store.db.run(
      "UPDATE companion_threads SET status='paused',version=version+1 WHERE profile_id=? AND status='active'",
      store.profileId,
    );
    const id = crypto.randomUUID();
    const data: Record<string, string> = {
      timezone: store.settings().timezone,
    };
    if (args.title && !["capture", "pause", "followup"].includes(args.flow))
      data.title = args.title;
    if (args.recordId)
      data.recordVersion = String(store.get(args.recordId).version);
    store.db.run(
      "INSERT INTO companion_threads(id,profile_id,flow,step,data,status,record_id,created_at,updated_at) VALUES (?,?,?,?,?,'active',?,?,?)",
      id,
      store.profileId,
      args.flow,
      data.title ? 1 : 0,
      JSON.stringify(data),
      args.recordId ?? null,
      store.now(),
      store.now(),
    );
    return result(get(store, id));
  }
  const t = get(store, args.id);
  if (operation === "resume") {
    if (t.status === "finished")
      throw Error(
        "This conversation is finished; continue its responsibility instead.",
      );
    if (
      t.recordId &&
      String(store.get(t.recordId).version) !== t.data.recordVersion
    ) {
      t.data = {
        timezone: store.settings().timezone,
        recordVersion: String(store.get(t.recordId).version),
      };
      t.step = 0;
    }
    store.db.run(
      "UPDATE companion_threads SET status='paused',version=version+1 WHERE profile_id=? AND status='active' AND id!=?",
      store.profileId,
      t.id,
    );
    store.db.run(
      "UPDATE companion_threads SET status='active',version=version+1,data=?,step=?,updated_at=? WHERE id=? AND profile_id=?",
      JSON.stringify(t.data),
      t.step,
      store.now(),
      t.id,
      store.profileId,
    );
    return {
      ...result(get(store, t.id)),
      message: `Your place is saved. ${get(store, t.id).question!.prompt}`,
    };
  }
  if (t.version !== args.version || t.status !== "active")
    throw Error(
      "This conversation changed in another window. Your answer has not been applied. Refresh and continue from the saved question.",
    );
  if (operation === "pause") {
    store.db.run(
      "UPDATE companion_threads SET status='paused',version=version+1,updated_at=? WHERE id=? AND profile_id=?",
      store.now(),
      t.id,
      store.profileId,
    );
    return {
      message:
        "I've saved this spot. You can pick it up from ‘Keeping track’ whenever you are ready.",
    };
  }
  if (operation === "back") {
    if (t.step < 1) throw Error("You are already at the first question.");
    t.step--;
    for (const q of questions(store, t).slice(t.step)) {
      delete t.data[q.key];
      delete t.data[q.key + "Instant"];
    }
    store.db.run(
      "UPDATE companion_threads SET data=?,step=?,version=version+1,updated_at=? WHERE id=? AND profile_id=?",
      JSON.stringify(t.data),
      t.step,
      store.now(),
      t.id,
      store.profileId,
    );
    return result(get(store, t.id));
  }
  if (
    t.recordId &&
    String(store.get(t.recordId).version) !== t.data.recordVersion
  )
    throw Error(
      "This responsibility changed while we were talking. Pick it up again to use its latest state.",
    );
  const q = t.question!;
  const skip = args.value === "__skip__";
  if (skip && !q.optional)
    throw Error("This question needs an answer so I can take the next step.");
  if (!skip) {
    if (args.value.length > (q.maxLength ?? 5000))
      throw Error("Keep this answer a little shorter.");
    if (q.choices && !q.choices.some((c) => c.value === args.value))
      throw Error("Choose one of the available answers.");
    if (q.type === "datetime-local") {
      t.data[q.key + "Instant"] = localToInstant(args.value, t.data.timezone);
    }
    if (
      q.type === "number" &&
      (!/^\d{1,4}$/.test(args.value) ||
        Number(args.value) >
          (q.key === "travel" ? 1440 : q.key === "preparation" ? 480 : 240))
    )
      throw Error("Enter a whole number of minutes within the allowed range.");
    t.data[q.key] = args.value;
  } else t.data[q.key] = "";
  store.message(
    "user",
    skip
      ? "Skip for now"
      : (q.choices?.find((c) => c.value === args.value)?.label ?? args.value),
    "user",
  );
  t.step++;
  t.question = questions(store, t)[t.step] ?? null;
  let output: ToolResult;
  if (t.question) output = result(t);
  else {
    output = finish(store, t, run);
    t.status = "finished";
    t.recordId =
      output.records?.find((r) => r.kind === "task")?.id ??
      output.records?.[0]?.id ??
      t.recordId;
  }
  store.db.run(
    "UPDATE companion_threads SET data=?,step=?,status=?,record_id=?,version=version+1,updated_at=? WHERE id=? AND profile_id=?",
    JSON.stringify(t.data),
    t.step,
    t.status,
    t.recordId,
    store.now(),
    t.id,
    store.profileId,
  );
  return output;
}
function finish(store: Store, t: Thread, run: Run): ToolResult {
  const d = t.data;
  const create = (kind: string, data: object, title = d.title) =>
    run("record.create", { kind, title, data });
  switch (t.flow) {
    case "start":
      return d.obstacle
        ? run("start.help", { title: d.title, obstacle: d.obstacle })
        : create("task", {
            nextAction:
              "Open the relevant material and choose one small action. You can stop there.",
          });
    case "capture":
      return create("capture", { body: d.body }, d.body.slice(0, 80));
    case "checkpoint":
      return create("checkpoint", {
        purpose: d.title,
        position: d.position,
        nextAction: d.nextAction,
        references: d.references,
      });
    case "return":
    case "appointment":
    case "form": {
      const r = create("task", {
        workflow: t.flow,
        references: d.references,
        deadline: d.deadlineInstant ?? null,
        dateKind: d.deadlineInstant ? "real" : "none",
        nextAction: "Prepare the information for review",
      }).records![0];
      const drafted = run("workflow.draft", { id: r.id });
      return {
        ...drafted,
        message: `I've kept “${d.title}” as an ongoing responsibility and prepared an unsent draft with your information. Review it, fill any gaps, and submit it through the official channel. Come back here when you have an update; I will keep the same thread.${d.deadlineInstant ? " Your confirmed deadline is scheduled in reminders." : " No deadline has been assumed."}`,
      };
    }
    case "person": {
      const r = create("person", {
        context: d.context,
        followUp: d.followUp,
        followUpAt: d.followUpAtInstant ?? null,
      });
      if (!d.followUp) return r;
      const draft = run("people.draft", { id: r.records![0].id });
      return {
        ...draft,
        records: [...r.records!, ...draft.records!],
        message:
          "I've saved the context you chose and prepared a message you can edit and send yourself.",
      };
    }
    case "handoff":
      return create("handoff", {
        outcome: d.outcome,
        owner: d.owner,
        information: d.information,
        deadline: d.deadlineInstant ?? null,
      });
    case "pause":
      return create("pause", {
        type: d.type,
        item: d.title,
        constraint: d.constraint,
        reviewAt: d.reviewAtInstant,
        ...(d.displaces ? { displaces: d.displaces } : {}),
      });
    case "transition": {
      const checkpoint = create(
        "checkpoint",
        {
          purpose: "Resume the work before " + d.title,
          position: d.position,
          nextAction: d.nextAction,
        },
        "Before " + d.title.slice(0, 220),
      ).records![0];
      return run("transition.plan", {
        title: d.title,
        checkpointId: checkpoint.id,
        localTime: d.commitmentAt,
        timezone: d.timezone,
        preparation: Number(d.preparation),
        windDown: Number(d.windDown),
        travel: Number(d.travel),
        buffer: Number(d.buffer),
      });
    }
    case "followup": {
      let r = store.get(t.recordId!);
      const update = (input: object) => {
        const out = run("record.update", {
          id: r.id,
          version: r.version,
          ...input,
        });
        r = out.records![0];
        return out;
      };
      if (d.change === "stuck")
        return run("start.help", {
          taskId: r.id,
          title: r.title,
          obstacle: d.obstacle,
        });
      if (d.change === "next")
        return update({ data: { nextAction: d.nextAction } });
      if (d.change === "submitted")
        update({ status: "submitted", evidence: d.evidence });
      if (["submitted", "waiting"].includes(d.change)) {
        if (!r.data.evidence)
          throw Error(
            "Record what was submitted before marking this as waiting. Your place is saved; resume this responsibility to choose the submission step.",
          );
        update({
          status: "waiting",
          data: {
            waitingOn: d.waitingOn,
            nextAction: `Check for a response from ${d.waitingOn}`,
          },
        });
        // An explicit update acknowledges any old nudge. A new wait gets one new scheduled check.
        store.db.run(
          "UPDATE notifications SET read_at=? WHERE profile_id=? AND record_id=? AND read_at IS NULL",
          store.now(),
          store.profileId,
          r.id,
        );
        return {
          message: `I've recorded your update. We're waiting on ${d.waitingOn}. A follow-up is scheduled for three days from now, subject to your reminder settings. I cannot check their inbox or response for you.`,
          records: [r],
        };
      }
      return {
        ...update({
          status: d.change,
          ...(d.evidence ? { evidence: d.evidence } : {}),
        }),
        message:
          d.change === "paused"
            ? "Set aside. The context is still here, and its scheduled reminders are paused."
            : "I've recorded the outcome you supplied and closed this responsibility. Its history is kept, and its reminders are cancelled.",
      };
    }
  }
}

export function continuity(store: Store) {
  const threads = getThreads(store);
  const records = store.list();
  const open = records.filter(
    (r) =>
      ["task", "handoff", "pause", "transition", "appointment"].includes(
        r.kind,
      ) && !["completed", "confirmed", "dropped"].includes(r.status),
  );
  const notifications = store.db.all(
    "SELECT n.id,n.record_id,n.title,n.body,n.created_at FROM notifications n JOIN records r ON r.id=n.record_id AND r.profile_id=n.profile_id WHERE n.profile_id=? AND n.read_at IS NULL AND r.status NOT IN ('completed','confirmed','dropped','paused') ORDER BY n.created_at DESC LIMIT 3",
    store.profileId,
  );
  const items = open.slice(0, 6).map((r) => {
    const job = store.db.all(
      "SELECT due_at,status FROM jobs WHERE profile_id=? AND record_id=? AND status IN ('pending','running') ORDER BY due_at LIMIT 1",
      store.profileId,
      r.id,
    )[0];
    return {
      record: r,
      nextCheck: job?.due_at ?? null,
      draft:
        records.find((x) => x.kind === "draft" && x.data.taskId === r.id) ??
        null,
    };
  });
  const recent = store.db.all(
    "SELECT e.id,e.action,e.created_at,r.id AS record_id,r.title FROM events e JOIN records r ON r.id=e.record_id AND r.profile_id=e.profile_id WHERE e.profile_id=? ORDER BY e.created_at DESC,e.rowid DESC LIMIT 5",
    store.profileId,
  );
  return { threads, items, notifications, recent };
}
export function modelContext(store: Store, message: string) {
  const records = store.list();
  const compact = (r: RecordItem) => ({
    id: r.id,
    version: r.version,
    kind: r.kind,
    title: r.title,
    status: r.status,
    updatedAt: r.updatedAt,
    data: JSON.stringify(r.data).slice(0, 1800),
  });
  return {
    relevant: store.search(message).map(compact),
    ongoing: records
      .filter(
        (r) =>
          ["task", "handoff", "pause", "person"].includes(r.kind) &&
          !["completed", "confirmed", "dropped"].includes(r.status),
      )
      .slice(0, 6)
      .map(compact),
    checkpoints: records
      .filter((r) => r.kind === "checkpoint")
      .slice(0, 2)
      .map(compact),
    unfinishedConversations: getThreads(store)
      .slice(0, 3)
      .map((t) => ({
        id: t.id,
        flow: flowLabels[t.flow],
        data: t.data,
        question: t.question?.prompt,
      })),
  };
}
