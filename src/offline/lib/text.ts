// Pure text helpers shared by the chat view, the speech queue and tests.

export interface ParsedAction {
  tool: string;
  args: Record<string, unknown>;
}

const ACTION_BLOCK = /<action>([\s\S]*?)<\/action>/g;
const QWEN_TOOL_CALL = /<tool_call>([\s\S]*?)<\/tool_call>/g;
const OPEN_TAG_AT_END = /<(action|tool_call|think)>[\s\S]*$/;

/** Remove reasoning blocks. An unterminated block at the end is still being generated. */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/, "")
    .replace(/^\s*<\/think>/, "");
}

function parseActionJson(raw: string): ParsedAction | null {
  try {
    const value = JSON.parse(raw.trim());
    const tool = value.tool ?? value.name;
    const args = value.args ?? value.arguments ?? {};
    if (typeof tool !== "string" || typeof args !== "object" || args === null)
      return null;
    return { tool, args };
  } catch {
    return null;
  }
}

/**
 * Split a model reply into the visible text and the actions it asked for.
 * Accepts the app's own <action>{...}</action> block and Qwen's native <tool_call> format.
 * Partially streamed blocks are hidden until they are complete.
 */
export function splitReply(raw: string): {
  text: string;
  actions: ParsedAction[];
} {
  const actions: ParsedAction[] = [];
  let text = stripThinking(raw);
  for (const pattern of [ACTION_BLOCK, QWEN_TOOL_CALL])
    text = text.replace(pattern, (_, body: string) => {
      const action = parseActionJson(body);
      if (action) actions.push(action);
      return "";
    });
  text = text.replace(OPEN_TAG_AT_END, "").replace(/<\/?[a-z_]*$/, "");
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), actions };
}

const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu;

/** Turn displayed markdown into something that sounds natural when read aloud. */
export function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/^#{1,6}\s+(.*)$/gm, "$1.")
    .replace(/^\s*[-*•]\s+(.*?)[.!?]?\s*$/gm, "$1.")
    .replace(/^\s*(\d+)[.)]\s+(.*?)[.!?]?\s*$/gm, "$2.")
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, "$2")
    .replace(EMOJI, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/&/g, " and ")
    .replace(/\s*\/\s*/g, " or ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/([.!?]),/g, "$1")
    .replace(/\.{2,}(?!\.)/g, "…")
    .trim();
}

const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "st",
  "vs",
  "etc",
  "e.g",
  "i.e",
  "approx",
  "min",
  "no",
]);

/**
 * Incremental sentence splitter for streamed text. Emits the first chunk early (at a comma
 * once it is long enough) so speech can start while the model is still writing, then
 * groups short sentences so the voice keeps natural phrasing instead of choppy fragments.
 */
export class SentenceChunker {
  private buffer = "";
  private emitted = 0;
  constructor(
    private readonly firstChunkWords = 9,
    private readonly targetChars = 180,
  ) {}

  push(delta: string): string[] {
    this.buffer += delta;
    return this.drain(false);
  }

  flush(): string[] {
    return this.drain(true);
  }

  private drain(final: boolean): string[] {
    const out: string[] = [];
    let pending = "";
    for (;;) {
      const cut = this.findBoundary(pending ? pending.length : 0);
      if (cut < 0) break;
      const sentence = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (!sentence) continue;
      pending = pending ? `${pending} ${sentence}` : sentence;
      if (this.emitted === 0 || pending.length >= this.targetChars / 2) {
        out.push(pending);
        this.emitted++;
        pending = "";
      }
    }
    if (pending) this.buffer = `${pending} ${this.buffer.trimStart()}`;
    if (final) {
      const rest = this.buffer.trim();
      this.buffer = "";
      if (rest) {
        out.push(rest);
        this.emitted++;
      }
    }
    return out.filter((s) => /[\p{L}\p{N}]/u.test(s));
  }

  /** Index just after the next sentence end in the buffer, or -1 if none is certain yet. */
  private findBoundary(alreadyPending: number): number {
    const b = this.buffer;
    for (let i = 0; i < b.length; i++) {
      const ch = b[i];
      if (ch === "\n" && b.slice(0, i).trim()) return i + 1;
      if (".!?…".includes(ch)) {
        let end = i + 1;
        while (end < b.length && `.!?…"')”’`.includes(b[end])) end++;
        if (end >= b.length) return -1; // might be "3.5" or "..." still streaming
        if (!/\s/.test(b[end])) continue;
        if (ch === ".") {
          const word = b
            .slice(0, i)
            .split(/\s+/)
            .pop()
            ?.toLowerCase()
            .replace(/^\W+/, "");
          if (word && (ABBREVIATIONS.has(word) || /^\d+$/.test(word))) continue;
        }
        return end;
      }
      if (
        this.emitted === 0 &&
        alreadyPending === 0 &&
        (ch === "," || ch === ";" || ch === ":") &&
        b.slice(0, i).trim().split(/\s+/).length >= this.firstChunkWords &&
        i + 1 < b.length &&
        /\s/.test(b[i + 1])
      )
        return i + 1;
    }
    return -1;
  }
}

/** A short title for a conversation from its first message. */
export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 42) return clean || "New chat";
  const cut = clean.slice(0, 42);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 20 ? cut.lastIndexOf(" ") : 42)}…`;
}
