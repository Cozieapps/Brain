import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  LayoutList,
  Menu,
  PanelRightClose,
  Plus,
  RotateCcw,
  Settings as Gear,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from "lucide-react";
import * as db from "./lib/db";
import type {
  ActionResult,
  Chat,
  ChatMessage,
  CheckIn,
  Note,
  Reminder,
  Task,
} from "./lib/db";
import { getLlm, getTts, type Progress } from "./lib/engine";
import {
  MODELS,
  VOICES,
  VOICE_MODEL,
  approxDeviceRamGB,
  findModel,
  recommendedModelId,
  type ModelChoice,
} from "./lib/models";
import {
  cachedBytes,
  deleteModel,
  firstCachedRepo,
  importFolder,
  isCached,
  requestPersistence,
  storageInfo,
  type StorageInfo,
} from "./lib/modelFiles";
import { buildMessages, systemPrompt } from "./lib/prompt";
import {
  loadTimer,
  saveTimer,
  useSettings,
  type TimerState,
} from "./lib/settings";
import { Speaker } from "./lib/speech";
import { splitReply, titleFrom } from "./lib/text";
import { parseSlash, runAction, undoAction } from "./lib/tools";
import { Rich } from "./components/Rich";
import { SettingsSheet, type LoadState } from "./components/SettingsSheet";
import { Today } from "./components/Today";

const STARTERS = [
  {
    title: "Brain dump",
    text: "I need to get everything out of my head. Help me sort it.",
    hint: "Empty your head, sort later",
  },
  {
    title: "I can't get started",
    text: "I can't get started on anything today.",
    hint: "Find a two-minute first step",
  },
  {
    title: "Plan the next two hours",
    text: "Help me plan the next two hours, gently.",
    hint: "Realistic, with breaks",
  },
  {
    title: "Body double me",
    text: "Body double me for 20 minutes while I tidy my desk.",
    hint: "Timer plus check-ins",
  },
  {
    title: "I'm overwhelmed",
    text: "I'm overwhelmed and don't know what to do first.",
    hint: "Shrink it down",
  },
  {
    title: "Help me reply",
    text: "Help me write a short, kind reply to a message I've been avoiding.",
    hint: "Draft the message you've been avoiding",
  },
];

function greeting(name: string) {
  const h = new Date().getHours();
  const part =
    h < 5
      ? "Still up"
      : h < 12
        ? "Good morning"
        : h < 18
          ? "Good afternoon"
          : "Good evening";
  return `${part}${name ? `, ${name}` : ""}.`;
}

export function App() {
  const [settings, update] = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [checkins, setCheckins] = useState<CheckIn[]>([]);

  const [model, setModel] = useState<LoadState>({ state: "idle" });
  const [voice, setVoice] = useState<LoadState>({ state: "idle" });
  const voiceReady = voice.state === "ready";
  const voiceReadyRef = useRef(false);
  voiceReadyRef.current = voiceReady;
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [storage, setStorage] = useState<StorageInfo | null>(null);

  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [timer, setTimer] = useState<TimerState | null>(loadTimer);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<
    null | "assistant" | "voice" | "you" | "privacy"
  >(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [todayOpen, setTodayOpen] = useState(() => window.innerWidth >= 1100);
  const [online, setOnline] = useState(navigator.onLine);

  const ramGB = useMemo(approxDeviceRamGB, []);
  const recommended = recommendedModelId(ramGB);
  const choice = findModel(settings.modelId || recommended);

  const speaker = useMemo(
    () =>
      new Speaker(
        () => ({
          engine: settingsRef.current.engine,
          voice: settingsRef.current.voice,
          speed: settingsRef.current.speed,
          systemVoice: settingsRef.current.systemVoice,
          kokoroReady: voiceReadyRef.current,
        }),
        setCaption,
      ),
    [],
  );

  const active = chats.find((c) => c.id === activeId) ?? null;
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ---------- data ----------
  const refresh = useCallback(async () => {
    const [c, t, r, n, k] = await Promise.all([
      db.all("chats"),
      db.all("tasks"),
      db.all("reminders"),
      db.all("notes"),
      db.all("checkins"),
    ]);
    setChats(c.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    setTasks(t.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    setReminders(r);
    setNotes(n.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    setCheckins(k.sort((a, b) => a.at.localeCompare(b.at)));
  }, []);

  const refreshCache = useCallback(async () => {
    const entries = await Promise.all(
      MODELS.map(
        async (m) => [m.id, (await firstCachedRepo(m.repos)) !== null] as const,
      ),
    );
    const voiceCached = await isCached(VOICE_MODEL);
    setCached({ ...Object.fromEntries(entries), [VOICE_MODEL]: voiceCached });
    setStorage(await storageInfo());
    return {
      ...Object.fromEntries(entries),
      [VOICE_MODEL]: voiceCached,
    } as Record<string, boolean>;
  }, []);

  // ---------- model & voice loading ----------
  const loadModel = useCallback(
    async (
      m: ModelChoice = findModel(settingsRef.current.modelId || recommended),
    ) => {
      const s = settingsRef.current;
      update({ modelId: m.id });
      const files = new Map<string, Progress>();
      setModel({
        state: "loading",
        loaded: 0,
        total: 0,
        label: `Waking up ${m.name}…`,
      });
      void requestPersistence();
      try {
        const info = await getLlm().load(
          {
            repos: s.customRepo ? [s.customRepo] : m.repos,
            device: s.llmDevice,
            allowRemote: !s.offlineLock,
            thinkingToggle: m.thinkingToggle,
          },
          (p) => {
            files.set(p.file, p);
            let loaded = 0;
            let total = 0;
            for (const f of files.values()) {
              loaded += f.loaded;
              total += f.total;
            }
            setModel({
              state: "loading",
              loaded,
              total,
              label:
                total > 0 && loaded < total
                  ? `Downloading ${m.name}`
                  : `Starting ${m.name}…`,
            });
          },
        );
        const where = info.device === "webgpu" ? "graphics chip" : "processor";
        setModel({
          state: "ready",
          detail: `${m.name} is running on the tablet's ${where}.`,
        });
        update({ setupDone: true });
        void refreshCache();
      } catch (err) {
        setModel({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [recommended, refreshCache],
  );

  const loadVoice = useCallback(async () => {
    const s = settingsRef.current;
    const files = new Map<string, Progress>();
    setVoice({
      state: "loading",
      loaded: 0,
      total: 0,
      label: "Preparing the voice…",
    });
    try {
      await getTts().load(
        {
          device: s.ttsDevice,
          allowRemote: !s.offlineLock,
          voices: [
            s.voice,
            ...VOICES.map((v) => v.id).filter((v) => v !== s.voice),
          ],
        },
        (p) => {
          files.set(p.file, p);
          let loaded = 0;
          let total = 0;
          for (const f of files.values()) {
            loaded += f.loaded;
            total += f.total;
          }
          setVoice({
            state: "loading",
            loaded,
            total,
            label: "Downloading the voice",
          });
        },
      );
      setVoice({
        state: "ready",
        detail: "Natural voice ready. It runs on the tablet.",
      });
      void refreshCache();
    } catch (err) {
      setVoice({
        state: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [refreshCache]);

  // Start whatever is already on the tablet.
  useEffect(() => {
    void (async () => {
      await refresh();
      const c = await refreshCache();
      const s = settingsRef.current;
      if (s.engine === "kokoro" && c[VOICE_MODEL]) void loadVoice();
      if (s.modelId && (c[s.modelId] || s.customRepo))
        void loadModel(findModel(s.modelId));
      else if (!s.setupDone) setSheet("assistant");
    })();
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);

  // Today is docked in landscape and slides over the chat in portrait; follow rotation.
  useEffect(() => {
    const wide = matchMedia("(min-width: 1100px)");
    const onChange = () => setTodayOpen(wide.matches);
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  // ---------- appearance ----------
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", settings.theme);
    root.dataset.size = settings.textSize;
  }, [settings.theme, settings.textSize]);

  // ---------- timer & reminders ----------
  const startTimer = useCallback((minutes: number, label: string) => {
    const t: TimerState = {
      label,
      minutes,
      startedAt: Date.now(),
      endsAt: Date.now() + minutes * 60_000,
      halfwaySaid: minutes < 4,
    };
    setTimer(t);
    saveTimer(t);
    setTodayOpen(true);
  }, []);

  const stopTimer = useCallback(() => {
    setTimer(null);
    saveTimer(null);
  }, []);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!timer) return;
    if (!timer.halfwaySaid && now >= (timer.startedAt + timer.endsAt) / 2) {
      const t = { ...timer, halfwaySaid: true };
      setTimer(t);
      saveTimer(t);
      const left = Math.round((timer.endsAt - now) / 60000);
      announce(
        `Halfway there. About ${left} minutes left on ${timer.label}. You're doing it.`,
      );
    }
    if (now >= timer.endsAt && !timer.endSaid) {
      const t = { ...timer, halfwaySaid: true, endSaid: true };
      setTimer(t);
      saveTimer(t);
      chime();
      announce(
        `Time's up on ${timer.label}. Nice work. Want a short break, or another round?`,
      );
    }
  }, [now, timer]);

  useEffect(() => {
    const due = reminders.filter(
      (r) => !r.fired && new Date(r.at).getTime() <= now,
    );
    for (const r of due) {
      const fired = { ...r, fired: true };
      void db.put("reminders", fired);
      setReminders((all) => all.map((x) => (x.id === r.id ? fired : x)));
      chime();
      announce(`Reminder: ${r.text}`);
      if ("Notification" in window && Notification.permission === "granted")
        new Notification("Beside", {
          body: r.text,
          icon: "/beside-voice.svg",
          tag: r.id,
        });
    }
  }, [now, reminders]);

  function announce(text: string) {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 8000);
    if (settingsRef.current.autoSpeak && !generating) speaker.say(text);
  }

  // ---------- chat ----------
  async function saveChat(chat: Chat) {
    await db.put("chats", chat);
    setChats((all) => [chat, ...all.filter((c) => c.id !== chat.id)]);
  }

  async function newChat() {
    speaker.stop();
    setActiveId(null);
    setSidebarOpen(false);
    setInput("");
    inputRef.current?.focus();
  }

  async function applyActions(
    actions: ReturnType<typeof splitReply>["actions"],
  ) {
    const results: ActionResult[] = [];
    for (const action of actions.slice(0, 3))
      results.push(await runAction(action, { startTimer }));
    if (results.length) await refresh();
    return results;
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || generating) return;
    speaker.unlock();
    if ("Notification" in window && Notification.permission === "default")
      void Notification.requestPermission();
    const base: Chat = active ?? {
      id: db.uid(),
      title: titleFrom(text.replace(/^\/\w+\s*/, "")),
      createdAt: db.now(),
      updatedAt: db.now(),
      messages: [],
    };
    const userMsg: ChatMessage = {
      id: db.uid(),
      role: "user",
      content: text,
      at: db.now(),
    };
    let chat: Chat = {
      ...base,
      updatedAt: db.now(),
      messages: [...base.messages, userMsg],
    };
    setInput("");
    setActiveId(chat.id);

    // Slash commands work instantly, even before a model is loaded.
    const slash = parseSlash(text);
    if (slash) {
      const actions = await applyActions([slash]);
      const reply: ChatMessage = {
        id: db.uid(),
        role: "assistant",
        content: actions[0].ok ? "Done." : actions[0].summary,
        at: db.now(),
        actions,
      };
      chat = { ...chat, messages: [...chat.messages, reply] };
      await saveChat(chat);
      if (settingsRef.current.autoSpeak) speaker.say(actions[0].summary);
      return;
    }

    await saveChat(chat);
    if (model.state !== "ready") {
      const reply: ChatMessage = {
        id: db.uid(),
        role: "assistant",
        content: "",
        at: db.now(),
        error:
          model.state === "loading"
            ? "Still waking up. Your message is saved; send it again in a moment."
            : "No model is running yet. Choose one in Settings to start chatting.",
      };
      await saveChat({ ...chat, messages: [...chat.messages, reply] });
      if (model.state !== "loading") setSheet("assistant");
      return;
    }

    setGenerating(true);
    setDraft("");
    const s = settingsRef.current;
    if (s.autoSpeak) speaker.begin();
    const system = systemPrompt({
      name: s.name || undefined,
      now: new Date(),
      tasks,
      lastCheckIn: checkins.at(-1),
      replyLength: s.replyLength,
      aboutMe: s.aboutMe || undefined,
    });
    let raw2 = "";
    let spoken = "";
    let frame = 0;
    try {
      const stats = await getLlm().generate(
        buildMessages(system, chat.messages),
        s.replyLength === "short" ? 320 : 640,
        (token) => {
          raw2 += token;
          const visible = splitReply(raw2).text;
          if (
            s.autoSpeak &&
            visible.startsWith(spoken) &&
            visible.length > spoken.length
          ) {
            speaker.feed(visible.slice(spoken.length));
            spoken = visible;
          }
          if (!frame)
            frame = requestAnimationFrame(() => {
              frame = 0;
              setDraft(splitReply(raw2).text);
            });
        },
      );
      cancelAnimationFrame(frame);
      const { text: reply, actions } = splitReply(raw2);
      if (s.autoSpeak) speaker.end();
      const results = await applyActions(actions);
      const content = reply || results.map((r) => r.summary).join(". ");
      if (s.autoSpeak && !reply && content) speaker.say(content);
      chat = {
        ...chat,
        updatedAt: db.now(),
        messages: [
          ...chat.messages,
          {
            id: db.uid(),
            role: "assistant",
            content,
            at: db.now(),
            actions: results,
            stats,
          },
        ],
      };
    } catch (err) {
      speaker.stop();
      chat = {
        ...chat,
        messages: [
          ...chat.messages,
          {
            id: db.uid(),
            role: "assistant",
            content: splitReply(raw2).text,
            at: db.now(),
            error: `Something went wrong: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    } finally {
      cancelAnimationFrame(frame);
      setGenerating(false);
      setDraft(null);
      await saveChat(chat);
    }
  }

  function stopAll() {
    getLlm().stop();
    speaker.stop();
  }

  async function undo(message: ChatMessage, index: number) {
    if (!active) return;
    const result = message.actions![index];
    await undoAction(result);
    const messages = active.messages.map((m) =>
      m.id === message.id
        ? {
            ...m,
            actions: m.actions!.map((a, i) =>
              i === index ? { ...a, undone: true } : a,
            ),
          }
        : m,
    );
    await saveChat({ ...active, messages });
    await refresh();
  }

  async function deleteChat(chat: Chat) {
    await db.remove("chats", chat.id);
    setChats((all) => all.filter((c) => c.id !== chat.id));
    if (activeId === chat.id) setActiveId(null);
  }

  // Keep the newest message in view while streaming.
  useEffect(() => {
    const el = logRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240)
      el.scrollTop = el.scrollHeight;
  }, [draft, active?.messages.length]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [activeId]);

  // Auto-grow composer.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // ---------- task panel handlers ----------
  const todayHandlers = {
    onAddTask: async (title: string) => {
      await db.put("tasks", {
        id: db.uid(),
        title,
        steps: [],
        done: false,
        createdAt: db.now(),
      });
      await refresh();
    },
    onToggleTask: async (t: Task) => {
      await db.put("tasks", {
        ...t,
        done: !t.done,
        doneAt: t.done ? undefined : db.now(),
      });
      await refresh();
    },
    onToggleStep: async (t: Task, i: number) => {
      const steps = t.steps.map((s, j) =>
        j === i ? { ...s, done: !s.done } : s,
      );
      await db.put("tasks", { ...t, steps });
      await refresh();
    },
    onDeleteTask: async (t: Task) => {
      await db.remove("tasks", t.id);
      await refresh();
    },
    onCheckIn: async (energy: CheckIn["energy"], cycle?: CheckIn["cycle"]) => {
      await db.put("checkins", { id: db.uid(), at: db.now(), energy, cycle });
      await refresh();
    },
    onDeleteReminder: async (r: Reminder) => {
      await db.remove("reminders", r.id);
      await refresh();
    },
    onDeleteNote: async (n: Note) => {
      await db.remove("notes", n.id);
      await refresh();
    },
  };

  const today = (
    <Today
      tasks={tasks}
      reminders={reminders}
      notes={notes}
      lastCheckIn={checkins.at(-1)}
      timer={timer}
      now={now}
      onStartTimer={startTimer}
      onStopTimer={stopTimer}
      onAsk={(p) => {
        if (window.innerWidth < 1100) setTodayOpen(false);
        void send(p);
      }}
      onClose={() => setTodayOpen(false)}
      {...todayHandlers}
    />
  );

  const statusDot =
    model.state === "ready"
      ? "ok"
      : model.state === "loading"
        ? "busy"
        : model.state === "error"
          ? "bad"
          : "";
  const groups = groupChats(chats);

  return (
    <div className={`app${todayOpen ? " with-today" : ""}`}>
      {sidebarOpen && (
        <div className="scrim" onClick={() => setSidebarOpen(false)} />
      )}
      <aside
        className={`sidebar${sidebarOpen ? " open" : ""}`}
        aria-label="Conversations"
      >
        <div className="brand">
          <img src="/beside-voice.svg" alt="" width="26" height="26" />
          <span>Beside</span>
          <button
            className="icon ghost only-narrow"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button className="new-chat" onClick={newChat}>
          <Plus size={16} /> New chat
        </button>
        <nav className="chat-list">
          {chats.length === 0 && (
            <p className="muted pad">Your chats stay on this tablet.</p>
          )}
          {groups.map(([label, list]) => (
            <div key={label}>
              <div className="group">{label}</div>
              {list.map((c) => (
                <div
                  key={c.id}
                  className={c.id === activeId ? "chat-item on" : "chat-item"}
                >
                  <button
                    className="chat-link"
                    onClick={() => {
                      speaker.stop();
                      setActiveId(c.id);
                      setSidebarOpen(false);
                    }}
                  >
                    {c.title}
                  </button>
                  <button
                    className="icon ghost del"
                    aria-label={`Delete chat ${c.title}`}
                    onClick={() => deleteChat(c)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="offline-pill">
            <WifiOff size={14} />
            <span>
              <strong>Private by design</strong>
              <span className="muted block">
                {online
                  ? "Nothing leaves this tablet"
                  : "Offline · all working"}
              </span>
            </span>
          </div>
          <button
            className="ghost side-btn"
            onClick={() => setSheet("assistant")}
          >
            <Gear size={16} /> Settings
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="top">
          <button
            className="icon ghost only-narrow"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <button
            className="model-pick"
            onClick={() => setSheet("assistant")}
            aria-label={`Model: ${choice.name}. Change model`}
          >
            <span className={`dot ${statusDot}`} aria-hidden />
            {choice.name}
            <ChevronDown size={15} />
          </button>
          <span className="status muted">
            {model.state === "loading"
              ? model.label
              : model.state === "ready"
                ? "On device"
                : model.state === "error"
                  ? "Needs attention"
                  : "Not started"}
          </span>
          <span className="grow" />
          <button
            className={settings.autoSpeak ? "icon ghost on" : "icon ghost"}
            aria-pressed={settings.autoSpeak}
            aria-label={
              settings.autoSpeak ? "Voice replies on" : "Voice replies off"
            }
            title={
              settings.autoSpeak ? "Voice replies on" : "Voice replies off"
            }
            onClick={() => {
              if (settings.autoSpeak) speaker.stop();
              update({ autoSpeak: !settings.autoSpeak });
            }}
          >
            {settings.autoSpeak ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <button
            className={todayOpen ? "icon ghost on" : "icon ghost"}
            aria-label={todayOpen ? "Hide today panel" : "Show today panel"}
            aria-pressed={todayOpen}
            onClick={() => setTodayOpen(!todayOpen)}
          >
            {todayOpen ? (
              <PanelRightClose size={19} />
            ) : (
              <LayoutList size={19} />
            )}
            {timer && !todayOpen && (
              <span className="timer-badge">
                {Math.max(0, Math.ceil((timer.endsAt - now) / 60000))}m
              </span>
            )}
          </button>
        </header>

        <div
          className="log"
          ref={logRef}
          tabIndex={0}
          aria-label="Conversation"
          aria-live="polite"
          aria-busy={generating}
        >
          {!active ? (
            <div className="empty">
              <img
                src="/beside-voice.svg"
                alt=""
                width="44"
                height="44"
                className="mark"
              />
              <h1>{greeting(settings.name)}</h1>
              <p className="muted">
                What's taking up space in your head? Type it messy. I'll answer
                out loud.
              </p>
              {(model.state === "idle" || model.state === "error") && (
                <div className="setup-card">
                  <p>
                    <strong>Set up your private assistant.</strong> It downloads
                    once, then runs entirely on this tablet with Wi-Fi off.
                  </p>
                  <button
                    className="primary"
                    onClick={() => setSheet("assistant")}
                  >
                    Choose a model
                  </button>
                </div>
              )}
              <div className="starters">
                {STARTERS.map((s) => (
                  <button
                    key={s.title}
                    className="starter"
                    onClick={() => void send(s.text)}
                  >
                    <strong>{s.title}</strong>
                    <span className="muted">{s.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="thread">
              {active.messages.map((m) => (
                <Message
                  key={m.id}
                  m={m}
                  onSpeak={() => {
                    speaker.unlock();
                    speaker.say(m.content);
                  }}
                  onUndo={(i) => void undo(m, i)}
                />
              ))}
              {draft !== null && (
                <div className="msg assistant">
                  <div className="avatar" aria-hidden>
                    <img
                      src="/beside-voice.svg"
                      alt=""
                      width="22"
                      height="22"
                    />
                  </div>
                  <div className="body">
                    {draft ? (
                      <Rich text={draft} />
                    ) : (
                      <span className="typing" aria-label="Thinking">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="dock">
          {caption && (
            <div className="caption" role="status">
              <span className="wave" aria-hidden>
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="caption-text">{caption}</span>
              <button className="small ghost" onClick={() => speaker.stop()}>
                <Square size={12} /> Stop
              </button>
            </div>
          )}
          {toast && !caption && (
            <div className="toast" role="status">
              {toast}
              <button
                className="icon ghost"
                aria-label="Dismiss"
                onClick={() => setToast(null)}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              placeholder={
                model.state === "ready"
                  ? "Message Beside…"
                  : "Message Beside… (try /timer 15 or /task call the dentist)"
              }
              aria-label="Message"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            {generating || caption ? (
              <button
                type="button"
                className="send stop"
                aria-label="Stop"
                onClick={stopAll}
              >
                <Square size={15} fill="currentColor" />
              </button>
            ) : (
              <button
                className="send"
                aria-label="Send"
                disabled={!input.trim()}
              >
                <ArrowUp size={18} />
              </button>
            )}
          </form>
          <p className="fine muted">
            Runs on this tablet. Beside can make mistakes and isn't medical
            advice.
          </p>
        </div>
      </main>

      {todayOpen && (
        <>
          <div className="scrim only-mid" onClick={() => setTodayOpen(false)} />
          <aside className="today-wrap">{today}</aside>
        </>
      )}

      {sheet && (
        <SettingsSheet
          tab={sheet}
          settings={settings}
          update={update}
          model={model}
          voice={voice}
          cached={cached}
          ramGB={ramGB}
          recommended={recommended}
          storage={storage}
          onLoadModel={() => {
            void loadModel(choice);
            if (settings.engine === "kokoro" && voice.state === "idle")
              void loadVoice();
          }}
          onLoadVoice={() => void loadVoice()}
          onPreviewVoice={() => {
            speaker.unlock();
            speaker.say(
              `Hi${settings.name ? ` ${settings.name}` : ""}, I'm Beside. Let's pick one small thing, and do just that. No pressure.`,
            );
          }}
          onImport={async (repo, files) => {
            setToast(`Importing ${files.length} files…`);
            const count = await importFolder(repo, files, (d, t) =>
              setToast(`Importing ${d} of ${t} files…`),
            );
            const bytes = await cachedBytes(repo);
            setToast(
              `Imported ${count} files (${(bytes / 1e9).toFixed(2)} GB). You can start it now.`,
            );
            await refreshCache();
          }}
          onDeleteModel={async (m) => {
            for (const repo of m.repos) await deleteModel(repo);
            await refreshCache();
          }}
          onExport={async () => {
            const data = {
              exportedAt: db.now(),
              settings,
              ...(await db.exportAll()),
            };
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = `beside-export-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
          onEraseAll={async () => {
            if (
              !confirm(
                "Erase all chats, tasks, notes, reminders and check-ins on this tablet? Models stay.",
              )
            )
              return;
            await db.clearAll();
            setActiveId(null);
            await refresh();
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function Message({
  m,
  onSpeak,
  onUndo,
}: {
  m: ChatMessage;
  onSpeak(): void;
  onUndo(i: number): void;
}) {
  const [copied, setCopied] = useState(false);
  if (m.role === "user")
    return (
      <div className="msg user">
        <div className="bubble">{m.content}</div>
      </div>
    );
  return (
    <div className="msg assistant">
      <div className="avatar" aria-hidden>
        <img src="/beside-voice.svg" alt="" width="22" height="22" />
      </div>
      <div className="body">
        {m.content && <Rich text={m.content} />}
        {m.actions && m.actions.length > 0 && (
          <ul className="actions">
            {m.actions.map((a, i) => (
              <li
                key={i}
                className={
                  a.ok
                    ? a.undone
                      ? "action undone"
                      : "action"
                    : "action failed"
                }
              >
                <span className="tick" aria-hidden>
                  {a.ok ? (
                    <Check size={13} strokeWidth={3} />
                  ) : (
                    <X size={13} strokeWidth={3} />
                  )}
                </span>
                <span className="grow">
                  {a.undone ? <s>{a.summary}</s> : a.summary}
                </span>
                {a.ok && a.undo && !a.undone && (
                  <button className="small ghost" onClick={() => onUndo(i)}>
                    <RotateCcw size={12} /> Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {m.error && <p className="error">{m.error}</p>}
        {m.content && (
          <div className="msg-tools">
            <button
              className="icon ghost"
              aria-label="Read aloud"
              title="Read aloud"
              onClick={onSpeak}
            >
              <Volume2 size={15} />
            </button>
            <button
              className="icon ghost"
              aria-label="Copy"
              title="Copy"
              onClick={() => {
                void navigator.clipboard?.writeText(m.content);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
            {m.stats && m.stats.tokensPerSecond > 0 && (
              <span className="stats muted">
                {m.stats.tokensPerSecond} tok/s · first word in{" "}
                {(m.stats.firstTokenMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function groupChats(chats: Chat[]): [string, Chat[]][] {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400_000).toDateString();
  const groups = new Map<string, Chat[]>();
  for (const c of chats) {
    const d = new Date(c.updatedAt).toDateString();
    const label =
      d === today ? "Today" : d === yesterday ? "Yesterday" : "Earlier";
    groups.set(label, [...(groups.get(label) ?? []), c]);
  }
  return [...groups];
}

let audioCtx: AudioContext | null = null;
/** A soft two-note chime, generated locally. */
function chime() {
  try {
    audioCtx ??= new AudioContext();
    const t = audioCtx.currentTime;
    for (const [i, freq] of [660, 880].entries()) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0, t + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.18, t + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.9);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t + i * 0.18);
      osc.stop(t + i * 0.18 + 1);
    }
  } catch {
    /* audio unavailable */
  }
}
