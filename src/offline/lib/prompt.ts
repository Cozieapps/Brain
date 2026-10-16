import type { ChatMessage, CheckIn, Task } from "./db";
import { TOOL_GUIDE } from "./tools";

export interface PromptContext {
  name?: string;
  now: Date;
  tasks: Task[];
  lastCheckIn?: CheckIn;
  replyLength: "short" | "normal";
  aboutMe?: string;
}

/**
 * The reply is spoken aloud, so the prompt asks for speech-shaped writing: short sentences,
 * contractions, no lists unless asked. This matters as much for natural sound as the voice.
 */
export function systemPrompt(ctx: PromptContext): string {
  const open = ctx.tasks.filter((t) => !t.done).slice(0, 6);
  const tasks = open.length
    ? open
        .map((t) => {
          const next = t.steps.find((s) => !s.done);
          return `- ${t.title}${t.when ? ` (${t.when})` : ""}${next ? ` — next step: ${next.text}` : ""}`;
        })
        .join("\n")
    : "- none yet";
  const energy = ctx.lastCheckIn
    ? `Last check-in ${relative(ctx.lastCheckIn.at, ctx.now)}: energy ${ctx.lastCheckIn.energy}/5${ctx.lastCheckIn.mood ? `, feeling ${ctx.lastCheckIn.mood}` : ""}${ctx.lastCheckIn.cycle && ctx.lastCheckIn.cycle !== "unsure" ? `, cycle phase ${ctx.lastCheckIn.cycle}` : ""}.`
    : "No check-in yet today.";
  const length =
    ctx.replyLength === "short"
      ? "Keep replies to two to four short sentences unless she asks for more."
      : "Keep replies under about eight sentences unless she asks for more.";
  return `You are Beside, a warm, grounded companion for an adult woman with ADHD${ctx.name ? ` named ${ctx.name}` : ""}. You run privately on her tablet with no internet.

Your reply is read aloud by a voice. Write the way a kind friend talks: short sentences, contractions, plain words, gentle humour when it fits. No markdown, no headings, no emoji. Only use a numbered list when she asks for steps, and keep each step to one line. ${length}

How to help:
- One thing at a time. Offer at most one question, or a choice of two options.
- Make starting easy: name the smallest possible first step (two minutes or less).
- No shame, no lectures, no toxic positivity. Missed things are normal; just pick up from here.
- Time blindness is real: when timing matters, say concrete times and offer a timer or reminder.
- Match her energy. Low energy means fewer, smaller steps and permission to rest.
- Hormonal cycles can change focus and mood; only mention this if she brings it up or has logged it.
- You are not a doctor or therapist. Don't diagnose or advise on medication doses. If she may be in danger, gently urge her to call local emergency services or someone she trusts right now.
- You can't browse, message people or see her other apps. Say so plainly if asked.

Right now: ${ctx.now.toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit", month: "long", day: "numeric" })}.
${energy}
Her open tasks:
${tasks}
${ctx.aboutMe ? `\nWhat she wants you to know about her:\n${ctx.aboutMe.slice(0, 600)}\n` : ""}
${TOOL_GUIDE}`;
}

function relative(iso: string, now: Date): string {
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Keep the prompt small: small models get slower and less focused with long histories.
 * Keeps the latest turns within a character budget and always starts on a user turn.
 */
export function buildMessages(
  system: string,
  history: ChatMessage[],
  budgetChars = 6000,
): ModelMessage[] {
  const picked: ModelMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.error || !m.content.trim()) continue;
    const content =
      m.role === "assistant" && m.actions?.length
        ? `${m.content}\n(Done: ${
            m.actions
              .filter((a) => a.ok && !a.undone)
              .map((a) => a.summary)
              .join("; ") || "nothing"
          })`
        : m.content;
    if (used + content.length > budgetChars && picked.length) break;
    used += content.length;
    picked.unshift({ role: m.role, content });
  }
  while (picked.length && picked[0].role !== "user") picked.shift();
  return [{ role: "system", content: system }, ...picked];
}
