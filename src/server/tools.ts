import {
  dataSchemas,
  resultSchema,
  toolSchemas,
  type RecordItem,
  type ToolName,
  type ToolResult,
} from "../shared/schema";
import { localToInstant, subtractMinutes, validTimezone } from "../shared/time";
import { Store } from "./store";
import { reconcileRecord, schedule, terminal } from "./jobs";
const READ_ONLY = new Set<ToolName>([
  "checkpoint.resume",
  "priority.next",
  "return.review",
  "memory.search",
]);
const MODEL_ALLOWED = new Set<ToolName>([
  "memory.search",
  "priority.next",
  "checkpoint.resume",
  "return.review",
]);
export function recommend(store: Store, overrideId?: string) {
  const tasks = store.list("task").filter(
    (r) =>
      !terminal.has(r.status) &&
      !["paused", "waiting", "blocked", "failed"].includes(r.status) &&
      r.data.dependencies.every((d: string) => {
        try {
          return ["completed", "confirmed"].includes(store.get(d).status);
        } catch {
          return false;
        }
      }),
  );
  if (overrideId) {
    const selected = tasks.find((r) => r.id === overrideId);
    if (!selected)
      throw new Error(
        "That task is paused, waiting, blocked, or unavailable. Update its state first.",
      );
    return selected;
  }
  const preferred = tasks.find(
    (r) => r.id === store.settings().preferredTaskId,
  );
  if (preferred) return preferred;
  const cap = store.settings().capacity;
  const score = (r: RecordItem) => {
    let n =
      r.data.priority * 10 +
      (r.data.essential ? 35 : 0) +
      (r.data.consequence ? 5 : 0);
    if (r.data.deadline && r.data.dateKind === "real") {
      const hours =
        (Date.parse(r.data.deadline) - store.clock().getTime()) / 3600000;
      n += hours < 0 ? 60 : hours < 24 ? 45 : hours < 72 ? 25 : 0;
    }
    if (cap === "low")
      n += r.data.effort === "small" ? 30 : r.data.effort === "large" ? -40 : 0;
    return n;
  };
  return (
    tasks.sort(
      (a, b) => score(b) - score(a) || a.createdAt.localeCompare(b.createdAt),
    )[0] ?? null
  );
}
function validateData(
  kind: RecordItem["kind"],
  data: unknown,
  store: Store,
  id?: string,
) {
  const parsed = dataSchemas[kind].parse(data) as Record<string, any>;
  if (parsed.timezone && !validTimezone(parsed.timezone))
    throw new Error("Choose a valid IANA time zone, such as America/New_York.");
  if (kind === "task") {
    if (parsed.deadline && parsed.dateKind === "none")
      throw new Error(
        "Is this a real deadline or a suggested target? Choose before saving.",
      );
    if (!parsed.deadline && parsed.dateKind !== "none")
      throw new Error("Choose an exact date, or select no deadline.");
    for (const dep of parsed.dependencies) {
      if (dep === id) throw new Error("A task cannot depend on itself.");
      const d = store.get(dep);
      if (d.kind !== "task")
        throw new Error("Dependencies must be responsibilities.");
      const seen = new Set<string>();
      const cycle = (r: RecordItem): boolean => {
        if (r.id === id) return true;
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return (r.data.dependencies ?? []).some((x: string) =>
          cycle(store.get(x)),
        );
      };
      if (cycle(d)) throw new Error("These dependencies would form a loop.");
    }
  }
  if (
    kind === "appointment" &&
    Date.parse(parsed.endsAt) <= Date.parse(parsed.startsAt)
  )
    throw new Error("The appointment must end after it starts.");
  const refs: Record<string, string> = {
    taskId: "task",
    personId: "person",
    checkpointId: "checkpoint",
    appointmentId: "appointment",
    displaces: "task",
  };
  for (const [key, expected] of Object.entries(refs))
    if (parsed[key] && store.get(parsed[key]).kind !== expected)
      throw new Error("Choose a valid linked item.");
  return parsed;
}
function validateStatus(
  kind: RecordItem["kind"],
  status: string,
  data: Record<string, any>,
  old?: RecordItem,
) {
  if (kind === "task" && data.workflow !== "general") {
    if (
      old &&
      ["submitted", "waiting"].includes(old.status) &&
      ["confirmed", "completed"].includes(status) &&
      data.evidence === old.data.evidence
    )
      throw new Error(
        "Add new outcome evidence. The submission receipt alone does not confirm the result.",
      );
    if (
      ["submitted", "waiting", "confirmed", "completed"].includes(status) &&
      !data.evidence
    )
      throw new Error(
        "Add the actual submission or outcome evidence. A draft alone is not a submission.",
      );
    if (
      ["completed", "confirmed"].includes(status) &&
      old &&
      !["submitted", "waiting", "confirmed", "completed"].includes(old.status)
    )
      throw new Error(
        "Record your actual submission first, then confirm the outcome.",
      );
  }
  if (
    kind === "handoff" &&
    ["accepted", "completed"].includes(status) &&
    !data.agreement
  )
    throw new Error(
      "Record the recipient’s actual agreement before marking this accepted.",
    );
  if (kind === "handoff" && status === "completed" && !data.evidence)
    throw new Error("Add the outcome evidence before completing the handoff.");
  if (kind === "transition" && status === "completed" && !data.evidence)
    throw new Error(
      "Confirm what happened, such as “I arrived.” An alert does not confirm arrival.",
    );
}
export function executeTool(
  store: Store,
  name: ToolName,
  input: unknown,
  actor: "user" | "model" = "user",
): ToolResult {
  if (!Object.hasOwn(toolSchemas, name)) throw new Error("Unknown tool.");
  if (actor === "model" && !MODEL_ALLOWED.has(name))
    throw new Error("This action requires your concrete review.");
  if (!READ_ONLY.has(name) && !store.settings().permissions.internal)
    throw new Error(
      "Internal editing permission is off. Enable it in Settings before making this change.",
    );
  const args: any = toolSchemas[name].parse(input);
  const result = store.db.transaction(() => run());
  return resultSchema.parse(result) as ToolResult;
  function run(): ToolResult {
    switch (name) {
      case "record.create": {
        const data = validateData(args.kind, args.data, store);
        const status =
          args.status ?? (args.kind === "handoff" ? "proposed" : "active");
        validateStatus(args.kind, status, data);
        const r = store.create(args.kind, args.title, data, status);
        reconcileRecord(store, r);
        return { message: `Saved “${r.title}”.`, records: [r] };
      }
      case "record.update": {
        const old = store.get(args.id);
        const data = validateData(
          old.kind,
          {
            ...old.data,
            ...args.data,
            ...(args.evidence !== undefined ? { evidence: args.evidence } : {}),
          },
          store,
          old.id,
        );
        validateStatus(old.kind, args.status ?? old.status, data, old);
        const r = store.update(old.id, args.version, {
          data,
          title: args.title ?? old.title,
          status: args.status ?? old.status,
        });
        reconcileRecord(store, r);
        return {
          message: `Updated “${r.title}”. You can undo this change.`,
          records: [r],
        };
      }
      case "record.delete":
        store.forget(args.id);
        return {
          message:
            "Forgotten. It is removed from search and future context. Conversation history was cleared to remove retained copies.",
        };
      case "record.undo": {
        const r = store.undo(args.id);
        reconcileRecord(store, r);
        return { message: "The previous state is restored.", records: [r] };
      }
      case "capture.toTask": {
        const capture = store.get(args.id);
        if (capture.kind !== "capture") throw new Error("Choose a capture.");
        if (capture.data.convertedTaskId) {
          try {
            return {
              message: "This capture already has a responsibility.",
              records: [store.get(capture.data.convertedTaskId)],
            };
          } catch {
            /* deleted task can be recreated */
          }
        }
        const r = store.create(
          "task",
          capture.title,
          dataSchemas.task.parse({
            nextAction: args.nextAction,
            references: capture.data.body,
          }),
        );
        store.update(capture.id, capture.version, {
          data: { ...capture.data, convertedTaskId: r.id },
        });
        return {
          message:
            "Your thought is now a responsibility, with one next action.",
          records: [r],
        };
      }
      case "start.help": {
        const task = args.taskId ? store.get(args.taskId) : null;
        if (task && task.kind !== "task")
          throw new Error("Choose a responsibility.");
        const steps = {
          unclear:
            "Open the relevant material and write down the one piece of information you are missing.",
          big: "Make a rough first pass at just one small piece. Stop before the next piece.",
          emotional:
            "Write a private, unsent first sentence. It can be imperfect; you decide whether to continue.",
          low: "Reduce this to the essential part, or choose a later target. Rest is an available next step.",
        };
        const next = steps[args.obstacle as keyof typeof steps];
        const data = dataSchemas.task.parse({
          ...task?.data,
          nextAction: next,
          obstacle: args.obstacle,
          effort: "small",
        });
        const r = task
          ? store.update(task.id, task.version, { data })
          : store.create("task", args.title, data);
        if (args.helpful)
          store.create(
            "memory",
            `Helpful approach: ${args.obstacle}`,
            dataSchemas.memory.parse({
              body: `I marked this approach as helpful for ${args.title}: ${next}`,
              source: "user",
              sourceRef: `task:${r.id}`,
            }),
          );
        return {
          message:
            next + " I can hold this place while you try. No timer needed.",
          records: [r],
          details: task?.data.references
            ? [`Your saved material: ${task.data.references}`]
            : ["No linked material yet. Add a reference if one would help."],
        };
      }
      case "checkpoint.resume": {
        const checkpoints = args.query
          ? store.search(args.query, "checkpoint")
          : store.list("checkpoint").slice(0, 1);
        if (!checkpoints.length)
          return {
            message:
              "There is no saved place matching that yet. Save what you were doing and one next action.",
            action: "checkpoint",
          };
        const c = checkpoints[0];
        return {
          message: `You were ${c.data.position}. Next: ${c.data.nextAction}`,
          records: checkpoints,
          details: [
            `Purpose: ${c.data.purpose}`,
            `Decisions: ${c.data.decisions || "None recorded"}`,
            `References: ${c.data.references || "None recorded"}`,
          ],
        };
      }
      case "priority.next": {
        if (args.overrideId) {
          if (actor !== "user" || !store.settings().permissions.internal)
            throw Error(
              "Changing your next action requires your editing permission and review.",
            );
          recommend(store, args.overrideId);
          store.saveSettings({
            ...store.settings(),
            preferredTaskId: args.overrideId,
          });
        }
        if (args.rest)
          return {
            message:
              "Rest is a valid next step. Your responsibilities are still saved; nothing has been marked complete.",
          };
        const r = recommend(store, args.overrideId);
        return {
          message: r
            ? `${r.data.nextAction}. ${r.data.deadline && r.data.dateKind === "real" ? "This has a real deadline. " : ""}${r.data.essential ? "You marked it essential. " : ""}${store.settings().capacity === "low" ? "I’ve favored smaller steps for today." : ""}`
            : "There is no unblocked next action right now. You can rest, capture something, or review a waiting item.",
          recommendation: r,
          details: store
            .list("task")
            .filter((t) => !terminal.has(t.status) && t.id !== r?.id)
            .slice(0, 3)
            .map(
              (t) =>
                `${t.title}: ${t.status === "waiting" ? "waiting on " + (t.data.waitingOn || "a response") : t.data.dateKind === "real" ? "check its real deadline" : "can be considered later; no real deadline recorded"}`,
            ),
        };
      }
      case "return.review": {
        const all = store.list("task");
        const active = all.filter((r) => !terminal.has(r.status));
        const late = active.filter(
          (r) =>
            r.data.deadline &&
            r.data.dateKind === "real" &&
            Date.parse(r.data.deadline) < store.clock().getTime(),
        );
        const done = all.filter(
          (r) => terminal.has(r.status) && r.status !== "dropped",
        );
        const rec = recommend(store);
        return {
          message: `Your place is here. ${active.length} ${active.length === 1 ? "responsibility is" : "responsibilities are"} still open. ${late.length ? `${late.length} passed a recorded deadline and may need a repair step.` : "Nothing needs to be caught up all at once."}${done.length ? ` You have recorded ${done.length} completed ${done.length === 1 ? "outcome" : "outcomes"}.` : ""}`,
          records: active,
          recommendation: rec,
          details: late.map(
            (r) =>
              `${r.title}: deadline ${r.data.deadline}. Check whether it is still possible, request an extension, or deliberately drop it. Nothing was deleted.`,
          ),
        };
      }
      case "people.draft": {
        const r = store.get(args.id);
        if (r.kind !== "person") throw new Error("Choose a person.");
        const body = `Hi ${r.title}, ${args.delayed ? "I’m coming back to this after a delay. " : ""}${r.data.followUp || "I wanted to check in."}${r.data.context ? "\n\n" + r.data.context : ""}\n\n[Edit this so it sounds like you.]`;
        const draft = store.create(
          "draft",
          `Message to ${r.title}`,
          dataSchemas.draft.parse({ body, personId: r.id }),
          "prepared",
        );
        return {
          message: "Here’s an editable draft. Nothing has been sent.",
          records: [draft],
        };
      }
      case "transition.plan": {
        const checkpoint = store.get(args.checkpointId);
        if (checkpoint.kind !== "checkpoint")
          throw new Error("Save your current place first.");
        const commitmentAt = localToInstant(args.localTime, args.timezone);
        const leaveAt = subtractMinutes(
          commitmentAt,
          args.travel + args.buffer,
        );
        const startAt = subtractMinutes(
          leaveAt,
          args.preparation + args.windDown,
        );
        const data = validateData(
          "transition",
          { ...args, commitmentAt, leaveAt, startAt },
          store,
        );
        const r = store.create("transition", args.title, data);
        reconcileRecord(store, r);
        return {
          message:
            "Your place is saved. The transition plan uses your travel estimate.",
          records: [r],
          details: [
            `Wind down at ${startAt}`,
            `Leave at ${leaveAt}`,
            `Commitment at ${commitmentAt}`,
          ],
        };
      }
      case "workflow.draft": {
        const r = store.get(args.id);
        if (r.kind !== "task") throw new Error("Choose a responsibility.");
        const intro = {
          return:
            "Hello, I would like to request a return/refund for [item and order number].\nReason: [your reason].\nPlease confirm the return instructions, deadline, and refund process.",
          appointment:
            "Hello, I would like to request an appointment for [reason you choose to share].\nMy available times are [times and time zone].\nPlease confirm an available time and anything I need to bring.",
          form: "Application preparation\nApplicant: [your details]\nRequired documents: [check requirements]\nMissing information: [list remaining items]\nReview and submit at: [official destination]",
          general: "Purpose: " + r.title + "\nFirst step: " + r.data.nextAction,
        };
        const body =
          intro[r.data.workflow as keyof typeof intro] +
          "\n\nSupporting information:\n" +
          (r.data.references || "[Add your references here]");
        const draft = store.create(
          "draft",
          `Draft: ${r.title}`,
          dataSchemas.draft.parse({ body, taskId: r.id }),
          "prepared",
        );
        const updated = store.update(r.id, r.version, {
          status: ["active", "prepared"].includes(r.status)
            ? "prepared"
            : r.status,
          data: {
            ...r.data,
            stage: "Review draft",
            nextAction:
              "Review the draft, fill its blanks, then submit it yourself through the official channel.",
          },
        });
        return {
          message:
            "Prepared for your review. Copy the draft, make your submission, then record the actual evidence here.",
          records: [draft, updated],
        };
      }
      case "capacity.set": {
        const s = store.settings();
        store.saveSettings({ ...s, capacity: args.capacity });
        return {
          message:
            args.capacity === "low"
              ? "We can make today smaller. I’ll favor small steps and limit reminders to at most one today. Essential responsibilities remain visible."
              : "Saved. Your current report guides recommendations and reminders.",
          recommendation: recommend(store),
        };
      }
      case "memory.search":
        return {
          message:
            "Here is what is actually saved. You can correct or forget any item.",
          records: store.search(args.query, "memory"),
        };
      case "reminder.schedule":
        schedule(store, args.recordId, args.at, args.essential);
        return {
          message:
            "Review time saved. Quiet hours and your notification budget still apply.",
        };
    }
  }
}
