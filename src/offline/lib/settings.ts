import { useEffect, useState } from "react";
import type { VoiceEngine } from "./speech";

export interface Settings {
  modelId: string;
  /** Overrides the catalog's repositories when set, e.g. a newer community build. */
  customRepo: string;
  llmDevice: "auto" | "wasm";
  voice: string;
  speed: number;
  engine: VoiceEngine;
  systemVoice: string;
  ttsDevice: "wasm" | "webgpu";
  autoSpeak: boolean;
  offlineLock: boolean;
  replyLength: "short" | "normal";
  name: string;
  aboutMe: string;
  theme: "system" | "light" | "dark";
  textSize: "s" | "m" | "l";
  setupDone: boolean;
}

export const DEFAULTS: Settings = {
  modelId: "",
  customRepo: "",
  llmDevice: "auto",
  voice: "af_heart",
  speed: 1.05,
  engine: "kokoro",
  systemVoice: "",
  ttsDevice: "wasm",
  autoSpeak: true,
  offlineLock: false,
  replyLength: "short",
  name: "",
  aboutMe: "",
  theme: "system",
  textSize: "m",
  setupDone: false,
};

const KEY = "beside.offline.settings";

function read(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(read);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* private mode: settings last for this visit */
    }
  }, [settings]);
  const update = (patch: Partial<Settings>) =>
    setSettings((s) => ({ ...s, ...patch }));
  return [settings, update] as const;
}

export interface TimerState {
  label: string;
  minutes: number;
  startedAt: number;
  endsAt: number;
  halfwaySaid: boolean;
  endSaid?: boolean;
}

export function loadTimer(): TimerState | null {
  try {
    const t = JSON.parse(
      localStorage.getItem("beside.offline.timer") ?? "null",
    );
    return t && t.endsAt > Date.now() - 60_000 ? t : null;
  } catch {
    return null;
  }
}

export function saveTimer(t: TimerState | null) {
  try {
    if (t) localStorage.setItem("beside.offline.timer", JSON.stringify(t));
    else localStorage.removeItem("beside.offline.timer");
  } catch {
    /* ignore */
  }
}
