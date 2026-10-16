/// <reference lib="webworker" />
import {
  AutoModelForCausalLM,
  AutoTokenizer,
  InterruptableStoppingCriteria,
  TextStreamer,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from "@huggingface/transformers";
import { configureRuntime, pickWebGpuDtype } from "./runtime";
import type { LlmIn, LlmOut } from "../lib/protocol";

const post = (msg: LlmOut) => self.postMessage(msg);

let tokenizer: PreTrainedTokenizer | null = null;
let model: PreTrainedModel | null = null;
let thinkingToggle = false;
const stopper = new InterruptableStoppingCriteria();

async function load(msg: Extract<LlmIn, { type: "load" }>) {
  await configureRuntime(msg.allowRemote);
  await model?.dispose();
  model = null;
  tokenizer = null;
  thinkingToggle = msg.thinkingToggle;
  const progress_callback = (p: {
    status: string;
    file?: string;
    loaded?: number;
    total?: number;
  }) => {
    if (p.status === "progress" && p.file)
      post({
        type: "progress",
        file: p.file,
        loaded: p.loaded ?? 0,
        total: p.total ?? 0,
      });
  };

  let lastError: unknown;
  const repos = msg.allowRemote ? msg.repos : await cachedRepos(msg.repos);
  if (!repos.length) {
    post({ type: "error", message: describeLoadError(null, false) });
    return;
  }
  for (const repo of repos) {
    try {
      tokenizer = await AutoTokenizer.from_pretrained(repo, {
        progress_callback,
      });
    } catch (err) {
      lastError = err;
      continue; // repository missing (or not cached while offline): try the next one
    }
    const attempts: { device: "webgpu" | "wasm"; dtype: string }[] = [];
    if (msg.device !== "wasm" && "gpu" in navigator) {
      const dtype = await pickWebGpuDtype();
      if (dtype) attempts.push({ device: "webgpu", dtype });
    }
    attempts.push({ device: "wasm", dtype: "q4" });
    for (const attempt of attempts) {
      try {
        model = await AutoModelForCausalLM.from_pretrained(repo, {
          device: attempt.device,
          dtype: attempt.dtype as "q4",
          progress_callback,
        });
        await warmUp();
        post({
          type: "ready",
          repo,
          device: attempt.device,
          dtype: attempt.dtype,
        });
        return;
      } catch (err) {
        lastError = err;
        await model?.dispose();
        model = null;
      }
    }
  }
  post({
    type: "error",
    message: describeLoadError(lastError, msg.allowRemote),
  });
}

/** With downloads blocked, only repositories already on the device can load. */
async function cachedRepos(repos: string[]): Promise<string[]> {
  const cache = await caches.open("transformers-cache");
  const found: string[] = [];
  for (const repo of repos)
    if (
      await cache.match(
        `https://huggingface.co/${repo}/resolve/main/config.json`,
      )
    )
      found.push(repo);
  return found;
}

function describeLoadError(err: unknown, allowRemote: boolean): string {
  const missing =
    "This model isn't on the tablet yet. Turn off offline lock to download it once, or import its folder.";
  if (err === null) return missing;
  const text = err instanceof Error ? err.message : String(err);
  if (/memory|allocation|OOM/i.test(text))
    return "The tablet ran out of memory loading this model. Close other apps or pick a smaller model.";
  if (!allowRemote)
    return `${missing} (Some of its files are missing: ${text})`;
  if (/404|Could not locate|Unauthorized|401/.test(text))
    return "Couldn't find this model's files. Check the repository name in Settings.";
  return `The model couldn't start: ${text}`;
}

/** One tiny pass compiles GPU shaders so the first real reply isn't delayed. */
async function warmUp() {
  if (!model || !tokenizer) return;
  const inputs = template([{ role: "user", content: "Hi" }]);
  await model.generate({ ...inputs, max_new_tokens: 1, do_sample: false });
}

function template(messages: { role: string; content: string }[]) {
  const options = {
    add_generation_prompt: true,
    return_dict: true,
    ...(thinkingToggle ? { enable_thinking: false } : {}),
  } as const;
  try {
    return tokenizer!.apply_chat_template(messages, options) as Record<
      string,
      unknown
    >;
  } catch {
    // Some templates reject a system role: fold it into the first user turn.
    const [first, ...rest] = messages;
    const merged =
      first?.role === "system" && rest[0]
        ? [
            { role: "user", content: `${first.content}\n\n${rest[0].content}` },
            ...rest.slice(1),
          ]
        : messages;
    return tokenizer!.apply_chat_template(merged, options) as Record<
      string,
      unknown
    >;
  }
}

async function generate(msg: Extract<LlmIn, { type: "generate" }>) {
  if (!model || !tokenizer) {
    post({ type: "error", id: msg.id, message: "The model isn't loaded yet." });
    return;
  }
  stopper.reset();
  const started = performance.now();
  let firstTokenMs = 0;
  let tokens = 0;
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      if (!firstTokenMs) firstTokenMs = performance.now() - started;
      post({ type: "token", id: msg.id, text });
    },
    token_callback_function: () => {
      tokens++;
    },
  });
  try {
    const inputs = template(msg.messages);
    await model.generate({
      ...inputs,
      max_new_tokens: msg.maxNewTokens,
      do_sample: true,
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      repetition_penalty: 1.05,
      streamer,
      stopping_criteria: stopper,
    });
    const seconds = (performance.now() - started - firstTokenMs) / 1000;
    post({
      type: "done",
      id: msg.id,
      tokens,
      firstTokenMs: Math.round(firstTokenMs),
      tokensPerSecond:
        seconds > 0 ? Math.round((tokens / seconds) * 10) / 10 : 0,
    });
  } catch (err) {
    post({
      type: "error",
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

self.onmessage = (event: MessageEvent<LlmIn>) => {
  const msg = event.data;
  if (msg.type === "load") void load(msg);
  else if (msg.type === "generate") void generate(msg);
  else if (msg.type === "stop") stopper.interrupt();
};
