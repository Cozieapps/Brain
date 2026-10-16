/// <reference lib="webworker" />
import { KokoroTTS } from "kokoro-js";
import { configureRuntime } from "./runtime";
import { VOICE_MODEL } from "../lib/models";
import type { TtsIn, TtsOut } from "../lib/protocol";

const post = (msg: TtsOut, transfer: Transferable[] = []) =>
  self.postMessage(msg, transfer);

let tts: KokoroTTS | null = null;
let queue: Extract<TtsIn, { type: "speak" }>[] = [];
let busy = false;
let cancelledUpTo = 0;
let highestId = 0;

const voiceUrl = (voice: string) =>
  `https://huggingface.co/${VOICE_MODEL}/resolve/main/voices/${voice}.bin`;

/** kokoro-js reads voice styles from this cache; fill it so voices work offline later. */
async function cacheVoices(voices: string[], allowRemote: boolean) {
  const cache = await caches.open("kokoro-voices");
  for (const voice of voices) {
    if (await cache.match(voiceUrl(voice))) continue;
    if (!allowRemote) continue;
    const res = await fetch(voiceUrl(voice));
    if (res.ok) await cache.put(voiceUrl(voice), res);
  }
}

async function load(msg: Extract<TtsIn, { type: "load" }>) {
  await configureRuntime(msg.allowRemote);
  try {
    tts = await KokoroTTS.from_pretrained(VOICE_MODEL, {
      dtype: msg.device === "webgpu" ? "fp32" : "q8",
      device: msg.device,
      progress_callback: (p: {
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
      },
    } as Parameters<typeof KokoroTTS.from_pretrained>[1]);
    await cacheVoices(msg.voices, msg.allowRemote);
    await tts.generate("Hi.", { voice: msg.voices[0] as "af_heart" }); // warm up kernels
    post({ type: "ready", device: msg.device });
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    post({
      type: "error",
      message: !msg.allowRemote
        ? "The voice isn't on the tablet yet. Turn off offline lock once to download it (about 90 MB)."
        : `The voice couldn't start: ${text}`,
    });
  }
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length && tts) {
    const job = queue.shift()!;
    try {
      const audio = await tts.generate(job.text, {
        voice: job.voice as "af_heart",
        speed: job.speed,
      });
      // A cancel while this sentence rendered drops it.
      if (cancelledUpTo >= job.id) continue;
      const samples = audio.audio as Float32Array;
      post(
        { type: "audio", id: job.id, samples, sampleRate: audio.sampling_rate },
        [samples.buffer],
      );
    } catch (err) {
      post({
        type: "error",
        id: job.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  busy = false;
}

self.onmessage = (event: MessageEvent<TtsIn>) => {
  const msg = event.data;
  if (msg.type === "load") void load(msg);
  else if (msg.type === "speak") {
    highestId = Math.max(highestId, msg.id);
    queue.push(msg);
    void pump();
  } else if (msg.type === "cancel") {
    cancelledUpTo = highestId;
    queue = [];
  }
};
