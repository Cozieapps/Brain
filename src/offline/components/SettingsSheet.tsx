import { useEffect, useRef, useState } from "react";
import {
  Cpu,
  Download,
  FolderInput,
  HardDrive,
  Lock,
  Play,
  Trash2,
  User,
  Volume2,
  X,
} from "lucide-react";
import {
  MODELS,
  VOICES,
  VOICE_MODEL,
  findModel,
  type ModelChoice,
} from "../lib/models";
import type { Settings } from "../lib/settings";
import type { StorageInfo } from "../lib/modelFiles";

export type LoadState =
  | { state: "idle" }
  | { state: "loading"; loaded: number; total: number; label: string }
  | { state: "ready"; detail: string }
  | { state: "error"; message: string };

interface Props {
  tab: "assistant" | "voice" | "you" | "privacy";
  settings: Settings;
  update(patch: Partial<Settings>): void;
  model: LoadState;
  voice: LoadState;
  cached: Record<string, boolean>;
  ramGB: number | null;
  recommended: string;
  storage: StorageInfo | null;
  onLoadModel(): void;
  onLoadVoice(): void;
  onPreviewVoice(): void;
  onImport(repo: string, files: File[]): void;
  onDeleteModel(model: ModelChoice): void;
  onExport(): void;
  onEraseAll(): void;
  onClose(): void;
}

const TABS = [
  { id: "assistant", label: "Assistant", icon: Cpu },
  { id: "voice", label: "Voice", icon: Volume2 },
  { id: "you", label: "About you", icon: User },
  { id: "privacy", label: "Privacy & storage", icon: Lock },
] as const;

export function SettingsSheet(props: Props) {
  const [tab, setTab] = useState<Props["tab"]>(props.tab);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        ref={panel}
      >
        <div className="sheet-head">
          <h2>Settings</h2>
          <button
            className="icon ghost"
            aria-label="Close settings"
            onClick={props.onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "tab on" : "tab"}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={15} /> {t.label}
            </button>
          ))}
        </div>
        <div className="sheet-body">
          {tab === "assistant" && <Assistant {...props} />}
          {tab === "voice" && <Voice {...props} />}
          {tab === "you" && <You {...props} />}
          {tab === "privacy" && <Privacy {...props} />}
        </div>
      </div>
    </div>
  );
}

export function Progress({ s }: { s: LoadState }) {
  if (s.state === "loading") {
    const pct = s.total
      ? Math.min(100, Math.round((s.loaded / s.total) * 100))
      : null;
    return (
      <div className="progress" role="status">
        <div className="bar">
          <span
            style={{ width: pct === null ? "30%" : `${pct}%` }}
            className={pct === null ? "indeterminate" : ""}
          />
        </div>
        <span className="muted">
          {s.label}
          {s.total
            ? ` · ${(s.loaded / 1e9).toFixed(2)} of ${(s.total / 1e9).toFixed(2)} GB`
            : ""}
        </span>
      </div>
    );
  }
  if (s.state === "error")
    return (
      <p className="error" role="alert">
        {s.message}
      </p>
    );
  if (s.state === "ready") return <p className="ok">{s.detail}</p>;
  return null;
}

function Assistant(p: Props) {
  const selected = p.settings.modelId || p.recommended;
  const busy = p.model.state === "loading";
  return (
    <>
      <p className="lead">
        Pick the brain Beside runs on. It downloads once, then works with Wi-Fi
        off.
        {p.ramGB ? ` This device reports about ${p.ramGB} GB of memory.` : ""}
      </p>
      <div className="models" role="radiogroup" aria-label="Model">
        {MODELS.map((m) => {
          const tight = p.ramGB !== null && p.ramGB < m.minRamGB;
          return (
            <label
              key={m.id}
              className={selected === m.id ? "model on" : "model"}
            >
              <input
                type="radio"
                name="model"
                checked={selected === m.id}
                onChange={() => p.update({ modelId: m.id, customRepo: "" })}
              />
              <span className="model-main">
                <span className="model-name">
                  {m.name}
                  {m.id === p.recommended && (
                    <span className="badge">Recommended</span>
                  )}
                  {p.cached[m.id] && (
                    <span className="badge ok">On tablet</span>
                  )}
                </span>
                <span className="muted">{m.blurb}</span>
                {tight && (
                  <span className="warn">
                    May not fit in this device's memory.
                  </span>
                )}
              </span>
              <span className="size">{m.sizeGB.toFixed(1)} GB</span>
            </label>
          );
        })}
      </div>
      <div className="row">
        <button className="primary" disabled={busy} onClick={p.onLoadModel}>
          {p.cached[selected] ? <Play size={16} /> : <Download size={16} />}
          {p.cached[selected] ? "Start this model" : "Download and start"}
        </button>
      </div>
      <Progress s={p.model} />
      <details className="advanced">
        <summary>Advanced</summary>
        <label className="field">
          <span>Custom model repository (ONNX, Transformers.js format)</span>
          <input
            value={p.settings.customRepo}
            placeholder={findModel(selected).repos[0]}
            onChange={(e) => p.update({ customRepo: e.target.value.trim() })}
          />
        </label>
        <label className="field">
          <span>Run the model on</span>
          <select
            value={p.settings.llmDevice}
            onChange={(e) =>
              p.update({ llmDevice: e.target.value as Settings["llmDevice"] })
            }
          >
            <option value="auto">Graphics chip when available (faster)</option>
            <option value="wasm">
              Processor only (slower, uses less graphics memory)
            </option>
          </select>
        </label>
      </details>
    </>
  );
}

function Voice(p: Props) {
  return (
    <>
      <p className="lead">
        Kokoro is a natural neural voice that runs on the tablet (about 90 MB).
        Beside starts speaking after the first phrase, so you don't wait for the
        whole answer.
      </p>
      <label className="switch">
        <input
          type="checkbox"
          checked={p.settings.autoSpeak}
          onChange={(e) => p.update({ autoSpeak: e.target.checked })}
        />
        <span>Read every reply aloud</span>
      </label>
      <div className="seg" role="radiogroup" aria-label="Voice engine">
        {(["kokoro", "system"] as const).map((e) => (
          <button
            key={e}
            role="radio"
            aria-checked={p.settings.engine === e}
            className={p.settings.engine === e ? "on" : ""}
            onClick={() => p.update({ engine: e })}
          >
            {e === "kokoro" ? "Natural (Kokoro)" : "Tablet's built-in voice"}
          </button>
        ))}
      </div>
      {p.settings.engine === "kokoro" && (
        <>
          <div className="voices" role="radiogroup" aria-label="Voice">
            {VOICES.map((v) => (
              <button
                key={v.id}
                role="radio"
                aria-checked={p.settings.voice === v.id}
                className={p.settings.voice === v.id ? "voice on" : "voice"}
                onClick={() => p.update({ voice: v.id })}
              >
                <strong>{v.name}</strong>
                <span className="muted">
                  {v.accent} · {v.note}
                </span>
              </button>
            ))}
          </div>
          {p.voice.state !== "ready" && (
            <button
              className="primary"
              disabled={p.voice.state === "loading"}
              onClick={p.onLoadVoice}
            >
              <Download size={16} />{" "}
              {p.cached[VOICE_MODEL]
                ? "Start the natural voice"
                : "Download the natural voice"}
            </button>
          )}
          <Progress s={p.voice} />
        </>
      )}
      <label className="field">
        <span>
          Speaking speed <strong>{p.settings.speed.toFixed(2)}×</strong>
        </span>
        <input
          type="range"
          min={0.8}
          max={1.4}
          step={0.05}
          value={p.settings.speed}
          onChange={(e) => p.update({ speed: Number(e.target.value) })}
        />
        <span className="muted">
          Kokoro changes its own pacing instead of fast-forwarding audio, so it
          stays human up to about 1.3×.
        </span>
      </label>
      <button onClick={p.onPreviewVoice}>
        <Play size={16} /> Hear a sample
      </button>
    </>
  );
}

function You(p: Props) {
  return (
    <>
      <label className="field">
        <span>What should Beside call you?</span>
        <input
          value={p.settings.name}
          onChange={(e) => p.update({ name: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Anything that helps Beside help you</span>
        <textarea
          rows={5}
          value={p.settings.aboutMe}
          maxLength={600}
          placeholder="e.g. Mornings are hard. I work from home. Long lists overwhelm me, so give me one thing at a time."
          onChange={(e) => p.update({ aboutMe: e.target.value })}
        />
      </label>
      <div className="seg" role="radiogroup" aria-label="Reply length">
        {(["short", "normal"] as const).map((r) => (
          <button
            key={r}
            role="radio"
            aria-checked={p.settings.replyLength === r}
            className={p.settings.replyLength === r ? "on" : ""}
            onClick={() => p.update({ replyLength: r })}
          >
            {r === "short" ? "Short answers (faster)" : "Fuller answers"}
          </button>
        ))}
      </div>
      <div className="field">
        <span>Text size</span>
        <div className="seg">
          {(["s", "m", "l"] as const).map((t) => (
            <button
              key={t}
              className={p.settings.textSize === t ? "on" : ""}
              onClick={() => p.update({ textSize: t })}
            >
              {t === "s" ? "Small" : t === "m" ? "Medium" : "Large"}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Theme</span>
        <div className="seg">
          {(["system", "light", "dark"] as const).map((t) => (
            <button
              key={t}
              className={p.settings.theme === t ? "on" : ""}
              onClick={() => p.update({ theme: t })}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function Privacy(p: Props) {
  const [importRepo, setImportRepo] = useState(
    findModel(p.settings.modelId || p.recommended).repos[0],
  );
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <label className="switch">
        <input
          type="checkbox"
          checked={p.settings.offlineLock}
          onChange={(e) => p.update({ offlineLock: e.target.checked })}
        />
        <span>
          <strong>Offline lock</strong>
          <span className="muted block">
            Never download anything. Chats, tasks and voice always stay on this
            tablet either way; this also blocks model downloads.
          </span>
        </span>
      </label>
      {p.storage && (
        <p className="muted">
          <HardDrive size={14} /> Using {p.storage.usedGB.toFixed(2)} GB of{" "}
          {p.storage.quotaGB.toFixed(0)} GB available to Beside.{" "}
          {p.storage.persisted
            ? "Protected from automatic clean-up."
            : "Not yet protected from clean-up."}
        </p>
      )}
      <h3>Models on this tablet</h3>
      <ul className="plain">
        {MODELS.filter((m) => p.cached[m.id]).map((m) => (
          <li key={m.id} className="line">
            <span className="grow">{m.name}</span>
            <button className="small" onClick={() => p.onDeleteModel(m)}>
              <Trash2 size={14} /> Remove
            </button>
          </li>
        ))}
        {!MODELS.some((m) => p.cached[m.id]) && (
          <li className="muted">None yet.</li>
        )}
      </ul>
      <h3>Import without internet</h3>
      <p className="muted">
        On a computer, download a model folder (for example{" "}
        <code>hf download {importRepo}</code>), copy it to the tablet, then
        choose that folder here.
      </p>
      <div className="row wrap">
        <select
          value={importRepo}
          onChange={(e) => setImportRepo(e.target.value)}
          aria-label="Folder contains"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.repos[0]}>
              {m.name}
            </option>
          ))}
          <option value={VOICE_MODEL}>Kokoro voice</option>
        </select>
        <button onClick={() => input.current?.click()}>
          <FolderInput size={16} /> Choose folder
        </button>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          {...({ webkitdirectory: "" } as Record<string, string>)}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) p.onImport(importRepo, files);
            e.target.value = "";
          }}
        />
      </div>
      <h3>Your data</h3>
      <div className="row wrap">
        <button onClick={p.onExport}>
          <Download size={16} /> Export everything
        </button>
        <button className="danger" onClick={p.onEraseAll}>
          <Trash2 size={16} /> Erase chats and tasks
        </button>
      </div>
    </>
  );
}
