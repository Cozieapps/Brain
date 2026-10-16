import { describe, expect, it } from "vitest";
import {
  SentenceChunker,
  splitReply,
  stripThinking,
  titleFrom,
  toSpeakable,
} from "../src/offline/lib/text";
import { matchTask, parseSlash, resolveWhen } from "../src/offline/lib/tools";
import { buildMessages, systemPrompt } from "../src/offline/lib/prompt";
import {
  pauseAfter,
  pickSystemVoice,
  trimSilence,
} from "../src/offline/lib/speech";
import { MODELS, recommendedModelId } from "../src/offline/lib/models";
import type { ChatMessage, Task } from "../src/offline/lib/db";

function streamThrough(text: string, size = 3) {
  const c = new SentenceChunker();
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size)
    out.push(...c.push(text.slice(i, i + size)));
  out.push(...c.flush());
  return out;
}

describe("reply parsing", () => {
  it("separates actions from the spoken text", () => {
    const r = splitReply(
      'Okay, I added it.\n<action>{"tool":"add_task","args":{"title":"Call Mum"}}</action>',
    );
    expect(r.text).toBe("Okay, I added it.");
    expect(r.actions).toEqual([
      { tool: "add_task", args: { title: "Call Mum" } },
    ]);
  });

  it("accepts Qwen's native tool-call format", () => {
    const r = splitReply(
      'Starting it now.<tool_call>{"name":"start_timer","arguments":{"minutes":10}}</tool_call>',
    );
    expect(r.actions).toEqual([{ tool: "start_timer", args: { minutes: 10 } }]);
    expect(r.text).toBe("Starting it now.");
  });

  it("hides half-streamed tags so they are never spoken", () => {
    expect(splitReply("Sure thing. <act").text).toBe("Sure thing.");
    expect(splitReply('Sure thing. <action>{"tool":"add_').text).toBe(
      "Sure thing.",
    );
  });

  it("ignores malformed action JSON", () => {
    const r = splitReply("Fine.<action>{not json}</action>");
    expect(r.actions).toEqual([]);
    expect(r.text).toBe("Fine.");
  });

  it("removes thinking blocks, including unfinished ones", () => {
    expect(stripThinking("<think>plan</think>Hello")).toBe("Hello");
    expect(stripThinking("Hi<think>still going")).toBe("Hi");
  });
});

describe("speech text", () => {
  it("drops markdown, emoji and links", () => {
    expect(toSpeakable("**Great** job 🎉 — see https://x.y/z")).toBe(
      "Great job, see a link",
    );
  });

  it("turns list items into sentences", () => {
    expect(toSpeakable("1. Open the laptop\n2. Write one line")).toBe(
      "Open the laptop. Write one line.",
    );
  });

  it("reads symbols as words", () => {
    expect(toSpeakable("Tea & toast, read/write")).toBe(
      "Tea and toast, read or write",
    );
  });
});

describe("sentence chunking for streamed speech", () => {
  it("starts with a short first chunk so speech begins quickly", () => {
    const chunks = streamThrough(
      "That sounds like a really heavy morning to carry around, and it makes sense you feel stuck. Let's pick one tiny thing. What's closest to you?",
    );
    expect(chunks[0]).toBe(
      "That sounds like a really heavy morning to carry around,",
    );
    expect(chunks.join(" ")).toContain("What's closest to you?");
  });

  it("does not split on decimals, abbreviations or times", () => {
    const chunks = streamThrough(
      "Take 2.5 minutes with Dr. Lee at 5 p.m. today. Then rest.",
    );
    expect(chunks.join(" | ")).not.toMatch(/2\. \||Dr\. \|/);
    expect(chunks.at(-1)).toContain("Then rest.");
  });

  it("groups very short sentences after the first", () => {
    const chunks = streamThrough(
      "Okay. Yes. Sure. Good. Fine. Done now, all good.",
    );
    expect(chunks[0]).toBe("Okay.");
    expect(chunks.length).toBeLessThan(5);
  });

  it("flushes the tail when the stream ends without punctuation", () => {
    expect(streamThrough("Hello there")).toEqual(["Hello there"]);
  });

  it("skips chunks with no letters", () => {
    expect(streamThrough("...")).toEqual([]);
  });
});

describe("voice playback helpers", () => {
  it("trims silent edges but keeps a little padding", () => {
    const s = new Float32Array(24000);
    s.fill(0.2, 6000, 18000);
    const t = trimSilence(s, 24000, 0.004, 0.03);
    expect(t.length).toBe(12000 + 2 * 720);
  });

  it("pauses longer after questions than after comma splits", () => {
    expect(pauseAfter("Ready?")).toBeGreaterThan(pauseAfter("First,"));
  });

  it("prefers natural offline English system voices", () => {
    const v = (name: string, lang: string, localService: boolean) =>
      ({ name, lang, localService }) as SpeechSynthesisVoice;
    const picked = pickSystemVoice([
      v("Basic", "en-US", true),
      v("Español", "es-ES", true),
      v("English Natural", "en-GB", true),
    ]);
    expect(picked?.name).toBe("English Natural");
  });
});

describe("tools", () => {
  const now = new Date(2026, 9, 16, 14, 0, 0);

  it("resolves minutes and clock times", () => {
    expect(resolveWhen({ minutes: 20 }, now)?.getTime()).toBe(
      now.getTime() + 20 * 60000,
    );
    expect(resolveWhen({ time: "17:30" }, now)?.getHours()).toBe(17);
    expect(resolveWhen({ time: "5pm" }, now)?.getHours()).toBe(17);
    const past = resolveWhen({ time: "09:00" }, now)!;
    expect(past.getDate()).toBe(17);
    expect(resolveWhen({ time: "25:00" }, now)).toBeNull();
    expect(resolveWhen({}, now)).toBeNull();
  });

  it("finds tasks from loose descriptions", () => {
    const tasks = [
      { id: "1", title: "Email Sam about Friday", done: false },
      { id: "2", title: "Book dentist appointment", done: false },
      { id: "3", title: "Old dentist thing", done: true },
    ] as Task[];
    expect(matchTask(tasks, "the dentist")?.id).toBe("2");
    expect(matchTask(tasks, "email sam about friday")?.id).toBe("1");
    expect(matchTask(tasks, "laundry")).toBeUndefined();
  });

  it("parses slash commands", () => {
    expect(parseSlash("/task Call the dentist")).toEqual({
      tool: "add_task",
      args: { title: "Call the dentist" },
    });
    expect(parseSlash("/timer 25 Inbox")).toEqual({
      tool: "start_timer",
      args: { minutes: 25, label: "Inbox" },
    });
    expect(parseSlash("/remind 20 take meds")).toEqual({
      tool: "set_reminder",
      args: { minutes: 20, text: "take meds" },
    });
    expect(parseSlash("/remind 17:30 leave for pickup")).toEqual({
      tool: "set_reminder",
      args: { time: "17:30", text: "leave for pickup" },
    });
    expect(parseSlash("/energy 2 foggy")).toEqual({
      tool: "log_checkin",
      args: { energy: 2, mood: "foggy" },
    });
    expect(parseSlash("hello /task")).toBeNull();
    expect(parseSlash("/unknown thing")).toBeNull();
  });
});

describe("prompt", () => {
  const msg = (
    role: "user" | "assistant",
    content: string,
    extra: Partial<ChatMessage> = {},
  ) => ({ id: content, role, content, at: "", ...extra }) as ChatMessage;

  it("keeps the latest turns within budget and starts with the user", () => {
    const history = [
      msg("user", "a".repeat(3000)),
      msg("assistant", "b".repeat(3000)),
      msg("user", "latest question"),
    ];
    const out = buildMessages("SYS", history, 3100);
    expect(out[0]).toEqual({ role: "system", content: "SYS" });
    expect(out.at(-1)?.content).toBe("latest question");
    expect(out[1].role).toBe("user");
  });

  it("skips failed turns and records completed actions", () => {
    const out = buildMessages("S", [
      msg("user", "add milk"),
      msg("assistant", "Added.", {
        actions: [{ tool: "add_task", ok: true, summary: "Added “milk”" }],
      }),
      msg("user", "again"),
      msg("assistant", "", { error: "boom" }),
    ]);
    expect(out.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(out[2].content).toContain("Done: Added “milk”");
  });

  it("asks for speech-shaped replies and includes her tasks", () => {
    const p = systemPrompt({
      now: new Date(2026, 9, 16, 9),
      tasks: [
        {
          id: "1",
          title: "Pay rent",
          steps: [{ text: "Open banking app", done: false }],
          done: false,
          createdAt: "",
        },
      ],
      replyLength: "short",
    });
    expect(p).toContain("read aloud");
    expect(p).toContain("Pay rent — next step: Open banking app");
    expect(p).toContain("<action>");
  });
});

describe("model catalog", () => {
  it("includes the requested families and recommends by memory", () => {
    const families = new Set(MODELS.map((m) => m.family));
    expect(families).toEqual(new Set(["Gemma 4", "Qwen 3.5", "Qwen 3"]));
    expect(MODELS.some((m) => m.id === "gemma-4-e4b")).toBe(true);
    expect(recommendedModelId(6)).toBe("qwen3.5-2b");
    expect(recommendedModelId(8)).toBe("qwen3.5-4b");
  });

  it("only turns off thinking for templates that support it", () => {
    for (const m of MODELS)
      expect(m.thinkingToggle).toBe(m.family !== "Gemma 4");
  });
});

describe("titles", () => {
  it("shortens long first messages on a word boundary", () => {
    expect(
      titleFrom("I need to get everything out of my head and sort it please"),
    ).toBe("I need to get everything out of my head…");
    expect(titleFrom("  ")).toBe("New chat");
  });
});
