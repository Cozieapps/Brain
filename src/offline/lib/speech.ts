// Streams the reply into speech: sentences go to the voice worker as soon as they are
// complete and play back-to-back with short, natural pauses.

import { getTts } from "./engine";
import { SentenceChunker, toSpeakable } from "./text";

export type VoiceEngine = "kokoro" | "system";

export interface SpeechSettings {
  engine: VoiceEngine;
  voice: string;
  speed: number;
  systemVoice?: string;
  kokoroReady: boolean;
}

/** Trim near-silent edges so pauses between sentences are even, not random. */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  threshold = 0.004,
  padSeconds = 0.03,
): Float32Array {
  let start = 0;
  let end = samples.length - 1;
  while (start < end && Math.abs(samples[start]) < threshold) start++;
  while (end > start && Math.abs(samples[end]) < threshold) end--;
  const pad = Math.round(padSeconds * sampleRate);
  return samples.subarray(
    Math.max(0, start - pad),
    Math.min(samples.length, end + pad + 1),
  );
}

/** Gap after a chunk: longer after a question or paragraph, shorter after a comma split. */
export function pauseAfter(text: string): number {
  if (/[?!]["')”’]*$/.test(text)) return 0.32;
  if (/[.…]["')”’]*$/.test(text)) return 0.26;
  return 0.12;
}

export function pickSystemVoice(
  voices: SpeechSynthesisVoice[],
  preferred?: string,
): SpeechSynthesisVoice | undefined {
  const chosen = preferred && voices.find((v) => v.name === preferred);
  if (chosen) return chosen;
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural|enhanced|premium|wavenet/i.test(v.name) ? 4 : 0) +
    (v.localService ? 2 : 0) +
    (/en-us/i.test(v.lang) ? 1 : 0);
  return english.sort((a, b) => score(b) - score(a))[0];
}

export class Speaker {
  private ctx: AudioContext | null = null;
  private chunker = new SentenceChunker();
  private seq = 0;
  private generation = 0;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private timers = new Set<number>();
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(
    private settings: () => SpeechSettings,
    private onCaption: (text: string | null) => void,
  ) {}

  /** Must run inside a tap or key press so the tablet allows audio. */
  unlock() {
    this.ctx ??= new AudioContext({ latencyHint: "playback" });
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if ("speechSynthesis" in window) speechSynthesis.getVoices();
  }

  begin() {
    this.stop();
    this.chunker = new SentenceChunker();
  }

  feed(delta: string) {
    for (const chunk of this.chunker.push(delta)) this.enqueue(chunk);
  }

  end() {
    for (const chunk of this.chunker.flush()) this.enqueue(chunk);
  }

  say(text: string) {
    this.begin();
    this.feed(text);
    this.end();
  }

  stop() {
    this.generation++;
    getTts().cancel();
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.chain = Promise.resolve();
    this.pending = 0;
    this.nextTime = 0;
    this.onCaption(null);
  }

  private enqueue(chunk: string) {
    const spoken = toSpeakable(chunk);
    if (!/[\p{L}\p{N}]/u.test(spoken)) return;
    const s = this.settings();
    const generation = this.generation;
    this.pending++;
    if (s.engine === "system" || !s.kokoroReady) {
      this.speakSystem(spoken, chunk, s, generation);
      return;
    }
    const id = ++this.seq;
    const rendered = getTts().synth(id, spoken, s.voice, s.speed);
    this.chain = this.chain
      .then(() => rendered)
      .then((audio) => {
        if (generation !== this.generation) return;
        if (!audio) return this.finishOne(generation);
        this.schedule(audio.samples, audio.sampleRate, chunk, generation);
      });
  }

  private schedule(
    samples: Float32Array,
    rate: number,
    caption: string,
    generation: number,
  ) {
    this.unlock();
    const ctx = this.ctx!;
    const trimmed = trimSilence(samples, rate);
    const buffer = ctx.createBuffer(1, trimmed.length, rate);
    buffer.copyToChannel(trimmed as Float32Array<ArrayBuffer>, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.04, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration + pauseAfter(caption);
    this.sources.add(source);
    const timer = window.setTimeout(
      () => {
        this.timers.delete(timer);
        if (generation === this.generation) this.onCaption(caption);
      },
      Math.max(0, (startAt - ctx.currentTime) * 1000),
    );
    this.timers.add(timer);
    source.onended = () => {
      this.sources.delete(source);
      this.finishOne(generation);
    };
  }

  private speakSystem(
    spoken: string,
    caption: string,
    s: SpeechSettings,
    generation: number,
  ) {
    if (!("speechSynthesis" in window)) return this.finishOne(generation);
    const u = new SpeechSynthesisUtterance(spoken);
    const voice = pickSystemVoice(speechSynthesis.getVoices(), s.systemVoice);
    if (voice) u.voice = voice;
    u.rate = s.speed;
    u.onstart = () => generation === this.generation && this.onCaption(caption);
    u.onend = u.onerror = () => this.finishOne(generation);
    speechSynthesis.speak(u);
  }

  private finishOne(generation: number) {
    if (generation !== this.generation) return;
    this.pending = Math.max(0, this.pending - 1);
    if (this.pending === 0) this.onCaption(null);
  }
}
