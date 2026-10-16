// Local tools the model (and slash commands) can use. All of them only touch this device.

import * as db from "./db";
import type { ActionResult, Task } from "./db";
import type { ParsedAction } from "./text";

export interface ToolContext {
  startTimer(minutes: number, label: string): void;
  now?: Date;
}

export const TOOL_GUIDE = `Tools (use only when the user clearly wants it, at most two per reply):
- add_task {"title": string, "steps"?: string[], "when"?: string}  save a to-do; steps are tiny, concrete first actions
- add_steps {"task": string, "steps": string[]}  break an existing task into smaller steps
- complete_task {"task": string}  mark a task done
- set_reminder {"text": string, "minutes"?: number, "time"?: "HH:MM"}  remind later today (24-hour time)
- start_timer {"minutes": number, "label"?: string}  start a focus timer; you will cheer her on at halfway
- save_note {"text": string}  keep a thought, idea or brain-dump item
- log_checkin {"energy": 1-5, "mood"?: string}  record how she is feeling right now
To use a tool, end your reply with one block per action, exactly like:
<action>{"tool": "add_task", "args": {"title": "Email Sam about Friday", "steps": ["Open email", "Write two lines"]}}</action>
Say what you did in plain words first. Never claim you used a tool without the block.`;

/** Turn "minutes" or "HH:MM" into a time. A clock time already passed today means tomorrow. */
export function resolveWhen(
  args: { minutes?: unknown; time?: unknown },
  now: Date,
): Date | null {
  const minutes = Number(args.minutes);
  if (Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60)
    return new Date(now.getTime() + minutes * 60_000);
  if (typeof args.time === "string") {
    const m = args.time
      .trim()
      .toLowerCase()
      .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return null;
    let hour = Number(m[1]);
    const minute = Number(m[2] ?? 0);
    if (m[3] === "pm" && hour < 12) hour += 12;
    if (m[3] === "am" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
    const at = new Date(now);
    at.setHours(hour, minute, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1);
    return at;
  }
  return null;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

/** Best open task for a loose description such as "the email one". */
export function matchTask(tasks: Task[], query: string): Task | undefined {
  const q = query.toLowerCase().trim();
  const open = tasks.filter((t) => !t.done);
  const exact = open.find((t) => t.title.toLowerCase() === q);
  if (exact) return exact;
  const contains = open.find(
    (t) =>
      t.title.toLowerCase().includes(q) || q.includes(t.title.toLowerCase()),
  );
  if (contains) return contains;
  const qw = new Set(words(query));
  let best: Task | undefined;
  let bestScore = 0;
  for (const t of open) {
    const score = words(t.title).filter((w) => qw.has(w)).length;
    if (score > bestScore) [best, bestScore] = [t, score];
  }
  return best;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown) =>
  Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, 8) : [];

function timeLabel(d: Date) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export async function runAction(
  action: ParsedAction,
  ctx: ToolContext,
): Promise<ActionResult> {
  const now = ctx.now ?? new Date();
  const a = action.args;
  const fail = (summary: string): ActionResult => ({
    tool: action.tool,
    ok: false,
    summary,
  });
  switch (action.tool) {
    case "add_task": {
      const title = str(a.title);
      if (!title) return fail("Couldn't add a task without a name.");
      const task: Task = {
        id: db.uid(),
        title,
        steps: strList(a.steps).map((text) => ({ text, done: false })),
        done: false,
        createdAt: now.toISOString(),
        when: str(a.when) || undefined,
      };
      await db.put("tasks", task);
      const steps = task.steps.length
        ? ` with ${task.steps.length} small steps`
        : "";
      return {
        tool: action.tool,
        ok: true,
        summary: `Added “${title}”${steps}`,
        undo: { store: "tasks", id: task.id },
      };
    }
    case "add_steps": {
      const task = matchTask(await db.all("tasks"), str(a.task));
      const steps = strList(a.steps);
      if (!task) return fail(`Couldn't find a task like “${str(a.task)}”.`);
      if (!steps.length) return fail("No steps were given.");
      const previous = structuredClone(task);
      task.steps.push(...steps.map((text) => ({ text, done: false })));
      await db.put("tasks", task);
      return {
        tool: action.tool,
        ok: true,
        summary: `Broke “${task.title}” into ${steps.length} steps`,
        undo: { store: "tasks", id: task.id, previous },
      };
    }
    case "complete_task": {
      const task = matchTask(await db.all("tasks"), str(a.task));
      if (!task) return fail(`Couldn't find a task like “${str(a.task)}”.`);
      const previous = structuredClone(task);
      task.done = true;
      task.doneAt = now.toISOString();
      await db.put("tasks", task);
      return {
        tool: action.tool,
        ok: true,
        summary: `Marked “${task.title}” done`,
        undo: { store: "tasks", id: task.id, previous },
      };
    }
    case "set_reminder": {
      const text = str(a.text);
      const at = resolveWhen(a, now);
      if (!text || !at) return fail("Couldn't tell when to remind you.");
      const reminder = {
        id: db.uid(),
        text,
        at: at.toISOString(),
        fired: false,
        createdAt: now.toISOString(),
      };
      await db.put("reminders", reminder);
      return {
        tool: action.tool,
        ok: true,
        summary: `Reminder at ${timeLabel(at)}: ${text}`,
        undo: { store: "reminders", id: reminder.id },
      };
    }
    case "start_timer": {
      const minutes = Math.round(Number(a.minutes));
      if (!(minutes >= 1 && minutes <= 180))
        return fail("Timers can run from 1 to 180 minutes.");
      const label = str(a.label) || "Focus";
      ctx.startTimer(minutes, label);
      return {
        tool: action.tool,
        ok: true,
        summary: `${minutes}-minute timer started: ${label}`,
      };
    }
    case "save_note": {
      const text = str(a.text);
      if (!text) return fail("Nothing to save.");
      const note = { id: db.uid(), text, createdAt: now.toISOString() };
      await db.put("notes", note);
      return {
        tool: action.tool,
        ok: true,
        summary: `Saved to notes: ${text.length > 60 ? text.slice(0, 57) + "…" : text}`,
        undo: { store: "notes", id: note.id },
      };
    }
    case "log_checkin": {
      const energy = Math.round(Number(a.energy));
      if (!(energy >= 1 && energy <= 5))
        return fail("Energy should be 1 to 5.");
      const checkin = {
        id: db.uid(),
        at: now.toISOString(),
        energy: energy as 1 | 2 | 3 | 4 | 5,
        mood: str(a.mood) || undefined,
      };
      await db.put("checkins", checkin);
      return {
        tool: action.tool,
        ok: true,
        summary: `Checked in: energy ${energy}/5${checkin.mood ? `, ${checkin.mood}` : ""}`,
        undo: { store: "checkins", id: checkin.id },
      };
    }
    default:
      return fail(`Unknown tool “${action.tool}”.`);
  }
}

export async function undoAction(result: ActionResult): Promise<void> {
  if (!result.undo) return;
  const { store, id, previous } = result.undo;
  if (previous) await db.put(store, previous as never);
  else await db.remove(store, id);
}

/**
 * Slash commands work instantly, without the model:
 * /task Call the dentist · /timer 15 Inbox · /remind 20 Take meds · /note Idea · /energy 3
 */
export function parseSlash(input: string): ParsedAction | null {
  const m = input.trim().match(/^\/(\w+)\s*(.*)$/s);
  if (!m) return null;
  const [, cmd, rest] = m;
  const lead = rest.match(
    /^(\d{1,2}:\d{2}|\d+)\s*(?:min(?:utes?)?|m)?\s*(.*)$/s,
  );
  switch (cmd.toLowerCase()) {
    case "task":
    case "todo":
      return rest ? { tool: "add_task", args: { title: rest } } : null;
    case "done":
      return rest ? { tool: "complete_task", args: { task: rest } } : null;
    case "timer":
    case "focus":
      return {
        tool: "start_timer",
        args: {
          minutes: lead ? Number(lead[1]) : 15,
          label: lead?.[2] || rest || "Focus",
        },
      };
    case "remind":
      if (!lead || !lead[2]) return null;
      return {
        tool: "set_reminder",
        args: lead[1].includes(":")
          ? { time: lead[1], text: lead[2] }
          : { minutes: Number(lead[1]), text: lead[2] },
      };
    case "note":
    case "dump":
      return rest ? { tool: "save_note", args: { text: rest } } : null;
    case "energy":
      return lead
        ? {
            tool: "log_checkin",
            args: { energy: Number(lead[1]), mood: lead[2] },
          }
        : null;
    default:
      return null;
  }
}
