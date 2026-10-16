// Messages exchanged with the model and voice workers.

export type LlmIn =
  | {
      type: "load";
      repos: string[];
      device: "auto" | "wasm";
      allowRemote: boolean;
      thinkingToggle: boolean;
    }
  | {
      type: "generate";
      id: string;
      messages: { role: "system" | "user" | "assistant"; content: string }[];
      maxNewTokens: number;
    }
  | { type: "stop" };

export type LlmOut =
  | { type: "progress"; file: string; loaded: number; total: number }
  | { type: "ready"; repo: string; device: string; dtype: string }
  | { type: "token"; id: string; text: string }
  | {
      type: "done";
      id: string;
      tokens: number;
      firstTokenMs: number;
      tokensPerSecond: number;
    }
  | { type: "error"; id?: string; message: string };

export type TtsIn =
  | {
      type: "load";
      device: "webgpu" | "wasm";
      allowRemote: boolean;
      voices: string[];
    }
  | { type: "speak"; id: number; text: string; voice: string; speed: number }
  | { type: "cancel" };

export type TtsOut =
  | { type: "progress"; file: string; loaded: number; total: number }
  | { type: "ready"; device: string }
  | { type: "audio"; id: number; samples: Float32Array; sampleRate: number }
  | { type: "error"; id?: number; message: string };
