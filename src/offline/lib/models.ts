// On-device model catalog. Sizes are approximate download sizes for the 4-bit builds;
// the setup screen shows the real byte counts as files arrive.

export type Dtype = "q4f16" | "q4" | "q8" | "fp16" | "fp32";

export interface ModelChoice {
  id: string;
  name: string;
  family: "Gemma 4" | "Qwen 3.5" | "Qwen 3";
  /** Repositories tried in order; the first one that answers is used. */
  repos: string[];
  sizeGB: number;
  /** Rough minimum device RAM for a comfortable experience. */
  minRamGB: number;
  blurb: string;
  /** Qwen-style templates accept enable_thinking; turning it off makes replies much faster. */
  thinkingToggle: boolean;
}

export const MODELS: ModelChoice[] = [
  {
    id: "gemma-4-e4b",
    name: "Gemma 4 E4B",
    family: "Gemma 4",
    repos: ["onnx-community/gemma-4-E4B-it-ONNX"],
    sizeGB: 3.6,
    minRamGB: 8,
    blurb:
      "Warmest, most natural writing. Needs the 8 GB tablet; slower to start.",
    thinkingToggle: false,
  },
  {
    id: "qwen3.5-4b",
    name: "Qwen 3.5 4B",
    family: "Qwen 3.5",
    repos: [
      "onnx-community/Qwen3.5-4B-ONNX",
      "onnx-community/Qwen3.5-4B-Text-ONNX",
    ],
    sizeGB: 2.9,
    minRamGB: 8,
    blurb:
      "Smartest that fits a tablet. Best at planning and breaking tasks down.",
    thinkingToggle: true,
  },
  {
    id: "qwen3-4b",
    name: "Qwen 3 4B",
    family: "Qwen 3",
    repos: ["onnx-community/Qwen3-4B-ONNX", "webgpu/Qwen3-4B-ONNX"],
    sizeGB: 2.8,
    minRamGB: 8,
    blurb: "Proven and steady. Reliable at using the built-in tools.",
    thinkingToggle: true,
  },
  {
    id: "gemma-4-e2b",
    name: "Gemma 4 E2B",
    family: "Gemma 4",
    repos: ["onnx-community/gemma-4-E2B-it-ONNX"],
    sizeGB: 2.1,
    minRamGB: 6,
    blurb: "Gemma's voice at about twice the speed. Good on the 6 GB tablet.",
    thinkingToggle: false,
  },
  {
    id: "qwen3.5-2b",
    name: "Qwen 3.5 2B",
    family: "Qwen 3.5",
    repos: [
      "onnx-community/Qwen3.5-2B-ONNX",
      "onnx-community/Qwen3.5-2B-Text-ONNX",
    ],
    sizeGB: 1.6,
    minRamGB: 6,
    blurb: "Fast replies, still capable. The everyday pick on 6 GB.",
    thinkingToggle: true,
  },
  {
    id: "qwen3.5-0.8b",
    name: "Qwen 3.5 0.8B",
    family: "Qwen 3.5",
    repos: [
      "onnx-community/Qwen3.5-0.8B-ONNX",
      "onnx-community/Qwen3.5-0.8B-Text-ONNX",
    ],
    sizeGB: 0.6,
    minRamGB: 4,
    blurb: "Very quick and light. Simple chats and quick captures only.",
    thinkingToggle: true,
  },
];

export const VOICE_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

export interface VoiceChoice {
  id: string;
  name: string;
  accent: "American" | "British";
  note: string;
}

/** Kokoro's highest-rated voices. Lower-graded ones sound noticeably more synthetic. */
export const VOICES: VoiceChoice[] = [
  {
    id: "af_heart",
    name: "Heart",
    accent: "American",
    note: "Warm and expressive",
  },
  {
    id: "af_bella",
    name: "Bella",
    accent: "American",
    note: "Bright, energetic",
  },
  {
    id: "af_nicole",
    name: "Nicole",
    accent: "American",
    note: "Soft, close, calm",
  },
  { id: "bf_emma", name: "Emma", accent: "British", note: "Clear and steady" },
  { id: "af_aoede", name: "Aoede", accent: "American", note: "Relaxed" },
  {
    id: "af_kore",
    name: "Kore",
    accent: "American",
    note: "Even and grounded",
  },
  { id: "bf_isabella", name: "Isabella", accent: "British", note: "Gentle" },
  {
    id: "am_michael",
    name: "Michael",
    accent: "American",
    note: "Low and easy",
  },
];

export function findModel(id: string): ModelChoice {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

/** navigator.deviceMemory rounds down to a power of two (a 6 GB tablet reports 4). */
export function approxDeviceRamGB(): number | null {
  const reported = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  if (!reported) return null;
  return reported >= 8 ? 8 : reported >= 4 ? 6 : reported;
}

export function recommendedModelId(ramGB: number | null): string {
  return ramGB !== null && ramGB < 8 ? "qwen3.5-2b" : "qwen3.5-4b";
}
