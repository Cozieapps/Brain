// Main-thread clients for the model and voice workers. Browser tests can swap in
// deterministic engines through window.__besideTest (never set in normal use).

import type { LlmIn, LlmOut, TtsIn, TtsOut } from "./protocol";
import type { ModelMessage } from "./prompt";

export interface Progress {
  file: string;
  loaded: number;
  total: number;
}

export interface LoadedModel {
  repo: string;
  device: string;
  dtype: string;
}

export interface GenerateStats {
  tokens: number;
  firstTokenMs: number;
  tokensPerSecond: number;
}

export interface LlmClient {
  load(
    opts: Omit<Extract<LlmIn, { type: "load" }>, "type">,
    onProgress: (p: Progress) => void,
  ): Promise<LoadedModel>;
  generate(
    messages: ModelMessage[],
    maxNewTokens: number,
    onToken: (text: string) => void,
  ): Promise<GenerateStats>;
  stop(): void;
}

export interface TtsClient {
  load(
    opts: Omit<Extract<TtsIn, { type: "load" }>, "type">,
    onProgress: (p: Progress) => void,
  ): Promise<void>;
  synth(
    id: number,
    text: string,
    voice: string,
    speed: number,
  ): Promise<{ samples: Float32Array; sampleRate: number } | null>;
  cancel(): void;
}

declare global {
  interface Window {
    __besideTest?: { llm?: () => LlmClient; tts?: () => TtsClient };
  }
}

class WorkerLlm implements LlmClient {
  private worker = new Worker(
    new URL("../workers/llm.worker.ts", import.meta.url),
    {
      type: "module",
    },
  );
  private listeners = new Set<(m: LlmOut) => void>();
  private seq = 0;
  constructor() {
    this.worker.onmessage = (e: MessageEvent<LlmOut>) =>
      this.listeners.forEach((l) => l(e.data));
  }
  private listen(fn: (m: LlmOut) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  load(
    opts: Omit<Extract<LlmIn, { type: "load" }>, "type">,
    onProgress: (p: Progress) => void,
  ) {
    return new Promise<LoadedModel>((resolve, reject) => {
      const off = this.listen((m) => {
        if (m.type === "progress") onProgress(m);
        else if (m.type === "ready") {
          off();
          resolve(m);
        } else if (m.type === "error" && !m.id) {
          off();
          reject(new Error(m.message));
        }
      });
      this.worker.postMessage({ type: "load", ...opts } satisfies LlmIn);
    });
  }
  generate(
    messages: ModelMessage[],
    maxNewTokens: number,
    onToken: (t: string) => void,
  ) {
    const id = String(++this.seq);
    return new Promise<GenerateStats>((resolve, reject) => {
      const off = this.listen((m) => {
        if (!("id" in m) || m.id !== id) return;
        if (m.type === "token") onToken(m.text);
        else if (m.type === "done") {
          off();
          resolve(m);
        } else if (m.type === "error") {
          off();
          reject(new Error(m.message));
        }
      });
      this.worker.postMessage({
        type: "generate",
        id,
        messages,
        maxNewTokens,
      } satisfies LlmIn);
    });
  }
  stop() {
    this.worker.postMessage({ type: "stop" } satisfies LlmIn);
  }
}

class WorkerTts implements TtsClient {
  private worker = new Worker(
    new URL("../workers/tts.worker.ts", import.meta.url),
    {
      type: "module",
    },
  );
  private waiting = new Map<
    number,
    (r: { samples: Float32Array; sampleRate: number } | null) => void
  >();
  private onLoad: ((m: TtsOut) => void) | null = null;
  constructor() {
    this.worker.onmessage = (e: MessageEvent<TtsOut>) => {
      const m = e.data;
      if (m.type === "audio") {
        this.waiting.get(m.id)?.({
          samples: m.samples,
          sampleRate: m.sampleRate,
        });
        this.waiting.delete(m.id);
      } else if (m.type === "error" && m.id !== undefined) {
        this.waiting.get(m.id)?.(null);
        this.waiting.delete(m.id);
      } else this.onLoad?.(m);
    };
  }
  load(
    opts: Omit<Extract<TtsIn, { type: "load" }>, "type">,
    onProgress: (p: Progress) => void,
  ) {
    return new Promise<void>((resolve, reject) => {
      this.onLoad = (m) => {
        if (m.type === "progress") onProgress(m);
        else if (m.type === "ready") resolve();
        else if (m.type === "error") reject(new Error(m.message));
      };
      this.worker.postMessage({ type: "load", ...opts } satisfies TtsIn);
    });
  }
  synth(id: number, text: string, voice: string, speed: number) {
    return new Promise<{ samples: Float32Array; sampleRate: number } | null>(
      (resolve) => {
        this.waiting.set(id, resolve);
        this.worker.postMessage({
          type: "speak",
          id,
          text,
          voice,
          speed,
        } satisfies TtsIn);
      },
    );
  }
  cancel() {
    this.worker.postMessage({ type: "cancel" } satisfies TtsIn);
    for (const resolve of this.waiting.values()) resolve(null);
    this.waiting.clear();
  }
}

let llm: LlmClient | null = null;
let tts: TtsClient | null = null;

export function getLlm(): LlmClient {
  llm ??= window.__besideTest?.llm?.() ?? new WorkerLlm();
  return llm;
}

export function getTts(): TtsClient {
  tts ??= window.__besideTest?.tts?.() ?? new WorkerTts();
  return tts;
}
