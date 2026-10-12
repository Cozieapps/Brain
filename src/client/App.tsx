import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Heart,
  Home,
  Inbox,
  Leaf,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pause,
  Plus,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  X,
  Undo2,
  Download,
  CalendarDays,
  Mic,
  Square,
  LogOut,
} from "lucide-react";
import { api, ApiError } from "./api";
import {
  labels,
  type RecordItem,
  type Settings,
  type ToolName,
} from "../shared/schema";
import { localToInstant } from "../shared/time";
import { Temporal } from "@js-temporal/polyfill";
type View = "companion" | "responsibilities" | "memory" | "inbox" | "settings";
type ModalState = { type: string; record?: RecordItem; status?: string };
const icons: Record<string, any> = {
  task: Check,
  capture: Bookmark,
  checkpoint: Bookmark,
  memory: Leaf,
  person: Users,
  handoff: Users,
  pause: Pause,
  appointment: CalendarDays,
  transition: Clock,
  draft: FileText,
  decision: Check,
};
const finish = new Set(["completed", "confirmed", "dropped"]);
const workflows = [
  ["start", "Help me start", "Find a first step that fits today."],
  ["checkpoint", "Hold my place", "Leave a thread for your future self."],
  ["carry", "Carry it through", "Returns, appointments, and applications."],
  ["priority", "What matters now?", "One next action, with room to choose."],
  [
    "transition",
    "Help me transition",
    "Make space between now and what’s next.",
  ],
  ["return", "Help me come back", "Pick up gently after time away."],
  [
    "person",
    "Remember my people",
    "Keep context and the replies you mean to send.",
  ],
  ["handoff", "Share the load", "A whole responsibility, clearly handed over."],
  ["pause", "Give me a pause", "Set something aside before deciding."],
  ["capacity", "Work with today", "Tell me what you have room for."],
];
export function App() {
  const [state, setState] = useState<any>(null),
    [view, setView] = useState<View>("companion"),
    [modal, setModal] = useState<ModalState | null>(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [login, setLogin] = useState(false),
    [setup, setSetup] = useState(false),
    [drawer, setDrawer] = useState(false),
    [filter, setFilter] = useState(""),
    [query, setQuery] = useState(""),
    [searchResults, setSearchResults] = useState<RecordItem[] | null>(null),
    [result, setResult] = useState<any>(null),
    [proposal, setProposal] = useState<any>(null),
    [returning, setReturning] = useState(false);
  const seen = useRef(new Set<string>());
  const first = useRef(true);
  async function refresh() {
    try {
      const s = await api("/state");
      setState(s);
      if (s.returning) setReturning(true);
      setLogin(false);
      setSetup(false);
      if (
        !first.current &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        for (const n of s.notifications)
          if (!seen.current.has(n.id) && !n.read_at)
            new Notification("Beside", { body: n.title, tag: n.id });
      }
      s.notifications.forEach((n: any) => seen.current.add(n.id));
      first.current = false;
      return s;
    } catch (e) {
      const x = e as ApiError;
      if (x.status === 401) {
        setLogin(true);
        setState(null);
      } else if (x.body?.needsSetup) {
        setSetup(true);
        setState(null);
      } else setError(x.message);
    }
  }
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  async function action(fn: () => Promise<any>) {
    setError("");
    setBusy(true);
    try {
      const r = await fn();
      await refresh();
      return r;
    } catch (e) {
      setError((e as Error).message);
      await refresh();
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function tool(name: ToolName, input: any, close = true) {
    const r = await action(() => api("/tool", { name, input }));
    if (r) {
      setResult(r);
      setToast(r.message);
      if (close) setModal(null);
    }
    return r;
  }
  async function saveSettings(patch: Partial<Settings>) {
    setState((previous: any) => ({
      ...previous,
      settings: { ...previous.settings, ...patch },
    }));
    const r = await action(() => api("/settings", patch));
    if (r) setToast("Preferences saved.");
    return r;
  }
  async function openWorkflow(type: string) {
    if (type === "return") setReturning(false);
    setResult(null);
    if (type === "priority" || type === "return") {
      setView("companion");
      const r = await tool(
        type === "priority" ? "priority.next" : "return.review",
        {},
      );
      setResult(r);
    } else if (type === "resume") {
      setView("companion");
      setResult(await tool("checkpoint.resume", {}));
    } else setModal({ type });
  }
  function nav(v: View) {
    setView(v);
    setDrawer(false);
    setFilter("");
    setQuery("");
    setSearchResults(null);
    setResult(null);
  }
  const records: RecordItem[] = state?.records ?? [];
  const settings: Settings = state?.settings;
  const active = records.filter(
    (r) => r.kind === "task" && !finish.has(r.status),
  );
  function displayDate(value: string | null, full = false) {
    if (!value) return "No date set";
    return new Intl.DateTimeFormat(undefined, {
      timeZone: settings?.timezone ?? "UTC",
      month: "short",
      day: "numeric",
      ...(full ? { hour: "numeric", minute: "2-digit" } : {}),
    }).format(new Date(value));
  }
  async function upload(file: File) {
    if (file.size > 3_000_000) {
      setError("Choose a file smaller than 3 MB.");
      return;
    }
    if (file.name.endsWith(".ics")) {
      const content = await file.text();
      const r = await action(() => api("/calendar/import", { content }));
      return r;
    }
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const mime =
      file.type.split(";")[0] ||
      (file.name.endsWith(".md") ? "text/markdown" : "text/plain");
    const r = await action(() =>
      api("/attachments", { name: file.name, mime, content: data }),
    );
    if (r) setToast("Attachment saved. It has not been read or transcribed.");
  }
  if (setup)
    return (
      <Gate title="Your private space needs a key">
        <p>
          Set a <code>BESIDE_PASSWORD</code> secret of at least 16 characters in
          Cloudflare → Worker → Settings → Variables and Secrets. Then reload.
        </p>
        <p>This protects your companion and personal data.</p>
        <button className="primary" onClick={() => void refresh()}>
          Check again
        </button>
      </Gate>
    );
  if (login)
    return (
      <Gate title="A little less to carry.">
        <p>Enter the passphrase for your private Beside.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void action(() =>
              api("/login", { password: data.get("password") }),
            );
          }}
        >
          <label>
            Your passphrase
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
            />
          </label>
          <button className="primary" disabled={busy}>
            Open my space <ArrowUpRight size={17} />
          </button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </Gate>
    );
  if (!state)
    return (
      <Gate title="Making a little room…">
        {error ? (
          <p role="alert">
            {error}
            <button onClick={() => void refresh()}>Try again</button>
          </p>
        ) : (
          <p>Opening your saved space.</p>
        )}
      </Gate>
    );
  const next = state.recommendation as RecordItem | null;
  const held = records.find((r) => r.kind === "checkpoint");
  const appointment = records
    .filter(
      (r) =>
        r.kind === "appointment" &&
        r.data.startsAt > new Date().toISOString() &&
        !finish.has(r.status),
    )
    .sort((a, b) => a.data.startsAt.localeCompare(b.data.startsAt))[0];
  const unread = state.notifications.filter((n: any) => !n.read_at).length;
  const visible = (searchResults ?? records)
    .filter((r) =>
      view === "memory"
        ? [
            "capture",
            "checkpoint",
            "memory",
            "person",
            "draft",
            "decision",
          ].includes(r.kind)
        : ["task", "handoff", "pause", "appointment", "transition"].includes(
            r.kind,
          ),
    )
    .filter((r) =>
      !filter || filter === "finished"
        ? !filter || finish.has(r.status)
        : r.kind === filter,
    );
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (drawer ? "is-open" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            nav("companion");
          }}
        >
          <img src="/beside.svg" alt="" />
          beside<span>●</span>
        </a>
        <div className="space-label">A LITTLE LESS TO CARRY</div>
        <nav aria-label="Main navigation">
          {(
            [
              ["companion", MessageCircle, "Your companion"],
              ["responsibilities", Check, "Responsibilities"],
              ["memory", Bookmark, "Things you’ve held"],
              ["inbox", Inbox, "Gentle reminders"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              aria-current={view === id ? "page" : undefined}
              onClick={() => nav(id)}
            >
              <Icon size={19} />
              {label}
              {id === "inbox" && unread > 0 && (
                <span className="nav-dot" aria-label="Unread reminders" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Sprig />
          <p>
            You don’t have to hold
            <br />
            everything in your head.
          </p>
        </div>
        <button
          className={"settings-nav " + (view === "settings" ? "active" : "")}
          onClick={() => nav("settings")}
        >
          <SettingsIcon size={19} />
          Your preferences
        </button>
        <div className="profile">
          <span className="avatar">
            {settings.name?.slice(0, 1).toUpperCase() || "Y"}
          </span>
          <div>
            {settings.name || "Your personal space"}
            <small>At your own pace</small>
          </div>
          <ShieldCheck size={16} />
        </div>
      </aside>
      {drawer && (
        <button
          className="drawer-backdrop"
          aria-label="Close navigation"
          onClick={() => setDrawer(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setDrawer(true)}
          >
            <Menu size={21} />
          </button>
          <span>
            {view === "companion"
              ? "A place to pick things up"
              : view === "responsibilities"
                ? "Held here, until you need them"
                : view === "memory"
                  ? "The little things, remembered"
                  : view === "inbox"
                    ? "A nudge, when it helps"
                    : "Make this space your own"}
          </span>
          <button className="mode-badge" onClick={() => nav("settings")}>
            <span className="status-dot" />
            {settings.mode === "none"
              ? "Guided · No AI"
              : settings.mode === "plan"
                ? "Using your ChatGPT plan"
                : "API · separately billed"}
            <ChevronDown size={13} />
          </button>
        </header>
        <main>
          {error && (
            <div className="error banner" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {view === "companion" ? (
            <div className="companion-layout">
              <section className="conversation-area">
                <div className="eyebrow">
                  <Sun size={15} />{" "}
                  {new Intl.DateTimeFormat("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    timeZone: settings.timezone,
                  }).format(new Date())}
                </div>
                <h1>
                  {settings.name
                    ? `A little room, ${settings.name}.`
                    : "A little less to carry."}
                </h1>
                <p className="intro">
                  Start where you are. We’ll take one thing at a time.
                </p>
                <div className="welcome-card">
                  <div>
                    <div className="tiny-label">RIGHT HERE, WITH YOU</div>
                    <h2>
                      {next
                        ? "One small place to begin."
                        : "What would make today a little easier?"}
                    </h2>
                    <p>
                      {next
                        ? next.title
                        : "A tangled thought. A task you can’t start. Something you don’t want to forget. There’s room for it here."}
                    </p>
                    <button
                      className="primary"
                      onClick={() =>
                        next
                          ? setModal({ type: "detail", record: next })
                          : setModal({ type: "start" })
                      }
                    >
                      {next ? "Take this one step" : "Let’s find a first step"}
                      <ArrowUpRight size={17} />
                    </button>
                  </div>
                  <StillLife />
                </div>
                <div className="quick-actions">
                  <button onClick={() => void openWorkflow("start")}>
                    <Sparkles size={18} />
                    <span>I’m stuck</span>
                  </button>
                  <button onClick={() => setModal({ type: "capture" })}>
                    <Bookmark size={18} />
                    <span>Hold this</span>
                  </button>
                  <button onClick={() => void openWorkflow("resume")}>
                    <Undo2 size={18} />
                    <span>Where was I?</span>
                  </button>
                  <button onClick={() => void openWorkflow("capacity")}>
                    <Leaf size={18} />
                    <span>Today’s too much</span>
                  </button>
                </div>
                <button
                  className="text-button more-help"
                  onClick={() => setModal({ type: "all" })}
                >
                  A few more ways I can help <ChevronDown size={14} />
                </button>
                {returning && (
                  <div className="result-panel">
                    <strong>Your place is still here.</strong>
                    <p>
                      It’s been a few days. We can check what’s still active and
                      choose one manageable way back.
                    </p>
                    <button
                      className="small-button"
                      onClick={() => void openWorkflow("return")}
                    >
                      Help me come back
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setReturning(false)}
                    >
                      Later is okay
                    </button>
                  </div>
                )}
                <div className="conversation-divider">
                  <span>OUR CONVERSATION</span>
                  <span>Yours to return to</span>
                </div>
                <div
                  className="messages"
                  aria-live="polite"
                  aria-label="Conversation"
                >
                  {!state.messages.length ? (
                    <div className="message assistant">
                      <img src="/beside.svg" alt="" />
                      <div>
                        <strong>Beside</strong>
                        <p>
                          You can put something down here, even if it’s
                          unfinished. What’s on your mind?
                        </p>
                        <small>Guided help · saved in your private space</small>
                      </div>
                    </div>
                  ) : (
                    state.messages.map((m: any) => (
                      <div key={m.id} className={"message " + m.role}>
                        {m.role === "assistant" && (
                          <img src="/beside.svg" alt="" />
                        )}
                        <div>
                          <strong>
                            {m.role === "assistant" ? "Beside" : "You"}
                            {m.source === "ai" && (
                              <span className="ai-label">AI suggestion</span>
                            )}
                          </strong>
                          <p>{m.content}</p>
                          {m.action === "start" && (
                            <button
                              className="small-button"
                              onClick={() => setModal({ type: "start" })}
                            >
                              Find a first step
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {result &&
                  (result.details?.length ||
                    result.records?.length ||
                    result.recommendation) && (
                    <div className="result-panel">
                      <strong>A little more context</strong>
                      {result.details?.map((d: string, i: number) => (
                        <p key={i}>{d}</p>
                      ))}
                      {result.recommendation && (
                        <button
                          className="record-link"
                          onClick={() =>
                            setModal({
                              type: "detail",
                              record: result.recommendation,
                            })
                          }
                        >
                          {result.recommendation.title}
                          <ChevronRight size={16} />
                        </button>
                      )}
                      {result.records?.slice(0, 8).map((r: RecordItem) => (
                        <button
                          className="record-link"
                          key={r.id}
                          onClick={() =>
                            setModal({
                              type: "detail",
                              record: records.find((x) => x.id === r.id) ?? r,
                            })
                          }
                        >
                          {r.title}
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    </div>
                  )}
                {proposal && (
                  <div className="result-panel">
                    <strong>Review a proposed action</strong>
                    <p>
                      Nothing has been changed. Check the exact fields before
                      applying.
                    </p>
                    <pre>{JSON.stringify(proposal, null, 2)}</pre>
                    <button
                      className="primary"
                      onClick={async () => {
                        if (await tool(proposal.name, proposal.input))
                          setProposal(null);
                      }}
                    >
                      Apply this action
                    </button>
                    <button onClick={() => setProposal(null)}>Dismiss</button>
                  </div>
                )}
                <Composer
                  busy={busy}
                  mode={settings.mode}
                  onSend={async (message) => {
                    const r = await action(() => api("/chat", { message }));
                    if (r) {
                      setResult(r);
                      setProposal(r.proposal ?? null);
                    }
                    return !!r;
                  }}
                  onFile={upload}
                  onError={setError}
                />
                <p className="composer-note">
                  {settings.mode === "none"
                    ? "No-AI mode uses saved notes and guided steps. Free-form AI conversation is off."
                    : "AI can be mistaken. Suggestions stay suggestions until you choose to act."}
                </p>
              </section>
              <aside className="context-area">
                <div className="context-heading">
                  <span>A LITTLE CONTEXT</span>
                  <MoreHorizontal size={18} />
                </div>
                <section className="capacity-card">
                  <div className="section-icon">
                    <Leaf size={20} />
                  </div>
                  <h3>How much room today?</h3>
                  <p>
                    Your answer can change.
                    <br />
                    Your plans can, too.
                  </p>
                  <div className="capacity-options">
                    {(
                      [
                        ["low", "A little"],
                        ["steady", "Some"],
                        ["room", "More"],
                      ] as const
                    ).map(([cap, label]) => (
                      <button
                        className={settings.capacity === cap ? "selected" : ""}
                        onClick={() =>
                          void tool("capacity.set", { capacity: cap }, false)
                        }
                        key={cap}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <small>
                    {settings.capacity === "low"
                      ? "Small steps. Fewer nudges."
                      : "We’ll work with what you have."}
                  </small>
                </section>
                <section className="context-section">
                  <div className="context-title">
                    <Bookmark size={17} />
                    <h3>Your place is held</h3>
                  </div>
                  {held ? (
                    <>
                      <p>{held.title}</p>
                      <small>{held.data.nextAction}</small>
                      <button
                        className="text-button"
                        onClick={() =>
                          setModal({ type: "detail", record: held })
                        }
                      >
                        Pick up the thread <ArrowUpRight size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <p>No thread to pick up yet.</p>
                      <small>Save where you are before you step away.</small>
                      <button
                        className="text-button"
                        onClick={() => setModal({ type: "checkpoint" })}
                      >
                        Hold my place <Plus size={14} />
                      </button>
                    </>
                  )}
                </section>
                <section className="context-section">
                  <div className="context-title">
                    <CalendarDays size={17} />
                    <h3>Coming up</h3>
                  </div>
                  {appointment ? (
                    <>
                      <p>{appointment.title}</p>
                      <small>
                        {displayDate(appointment.data.startsAt, true)} ·{" "}
                        {settings.timezone}
                      </small>
                      <button
                        className="text-button"
                        onClick={() =>
                          setModal({ type: "detail", record: appointment })
                        }
                      >
                        Make room for it <ArrowUpRight size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <p>A little open space.</p>
                      <small>
                        Add an appointment when there’s something to plan
                        around.
                      </small>
                      <button
                        className="text-button"
                        onClick={() => setModal({ type: "appointment" })}
                      >
                        Add a date <Plus size={14} />
                      </button>
                    </>
                  )}
                </section>
                <div className="gentle-note">
                  <Heart size={17} />
                  <p>
                    A smaller step still counts.
                    <br />
                    So does a pause.
                  </p>
                </div>
              </aside>
            </div>
          ) : view === "settings" ? (
            <SettingsView
              state={state}
              save={saveSettings}
              action={action}
              refresh={refresh}
              toast={setToast}
              error={setError}
            />
          ) : view === "inbox" ? (
            <section className="secondary">
              <div className="eyebrow">AT YOUR OWN PACE</div>
              <h1>Gentle reminders.</h1>
              <p className="intro">
                A place to check in. No need to clear everything.
              </p>
              <div className="worker-banner">
                <span
                  className={
                    "status-dot " + (!state.worker.online ? "muted" : "")
                  }
                />
                {state.worker.online
                  ? "Reminder worker checked in"
                  : "Waiting for a worker check"}
                {state.worker.checked && (
                  <small>{displayDate(state.worker.checked, true)}</small>
                )}
              </div>
              <p className="help-text">
                {state.worker.delivery} Your server needs to be running for
                scheduled work.
              </p>
              {!state.notifications.length && (
                <Empty
                  title="Nothing asking for your attention."
                  body="Reminders you choose will arrive here, within your quiet hours and daily budget."
                />
              )}
              {state.notifications.map((n: any) => (
                <article
                  className={"inbox-item " + (n.read_at ? "read" : "")}
                  key={n.id}
                >
                  <span className="round-icon">
                    <Clock size={19} />
                  </span>
                  <div>
                    <h3>{n.title}</h3>
                    <p>{n.body}</p>
                    <small>{displayDate(n.created_at, true)}</small>
                    <div className="inline-actions">
                      <button
                        onClick={() => {
                          const r = records.find((x) => x.id === n.record_id);
                          if (r) setModal({ type: "detail", record: r });
                        }}
                      >
                        Review
                      </button>
                      {!n.read_at && (
                        <button
                          onClick={() =>
                            void action(() =>
                              api("/inbox/" + n.id + "/read", {}),
                            )
                          }
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
              <h2 className="section-subtitle">Scheduled reviews</h2>
              {state.jobs
                .filter((j: any) =>
                  ["pending", "running", "failed"].includes(j.status),
                )
                .map((j: any) => (
                  <div className="schedule-row" key={j.id}>
                    <div>
                      {records.find((r) => r.id === j.record_id)?.title ??
                        "Saved item"}
                      <small>
                        {displayDate(j.due_at, true)} · {j.status}
                      </small>
                    </div>
                    <button
                      className="text-button"
                      onClick={() =>
                        void action(() => api("/jobs/" + j.id + "/cancel", {}))
                      }
                    >
                      Cancel
                    </button>
                  </div>
                ))}
            </section>
          ) : (
            <section className="secondary">
              <div className="eyebrow">
                {view === "memory" ? "LESS TO REMEMBER" : "NOT ALL AT ONCE"}
              </div>
              <div className="page-heading">
                <h1>
                  {view === "memory"
                    ? "Things you’ve held."
                    : "Responsibilities."}
                </h1>
                <button
                  className="primary"
                  onClick={() =>
                    setModal({ type: view === "memory" ? "capture" : "carry" })
                  }
                >
                  <Plus size={16} />
                  Add something
                </button>
              </div>
              <p className="intro">
                {view === "memory"
                  ? "Your thoughts, places, people, and context. All yours to change."
                  : "The next steps, the waiting, and the things you’ve decided to let go."}
              </p>
              <div className="list-toolbar">
                <div className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search saved items"
                    placeholder="Find something, even approximately…"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      if (!e.target.value) setSearchResults(null);
                    }}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter") {
                        const r = await action(() =>
                          api("/search?q=" + encodeURIComponent(query)),
                        );
                        if (r) setSearchResults(r.records);
                      }
                    }}
                  />
                  <button
                    onClick={async () => {
                      const r = await action(() =>
                        api("/search?q=" + encodeURIComponent(query)),
                      );
                      if (r) setSearchResults(r.records);
                    }}
                  >
                    Find
                  </button>
                </div>
                <select
                  aria-label="Filter items"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="">Everything</option>
                  {(view === "memory"
                    ? [
                        "capture",
                        "checkpoint",
                        "memory",
                        "person",
                        "draft",
                        "decision",
                      ]
                    : [
                        "task",
                        "handoff",
                        "pause",
                        "appointment",
                        "transition",
                        "finished",
                      ]
                  ).map((k) => (
                    <option key={k} value={k}>
                      {k === "finished"
                        ? "Completed & let go"
                        : labels[k as keyof typeof labels]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="item-grid">
                {visible.map((r) => (
                  <RecordCard
                    key={r.id}
                    record={r}
                    onClick={() => setModal({ type: "detail", record: r })}
                    date={displayDate}
                  />
                ))}
              </div>
              {!visible.length && (
                <Empty
                  title={
                    query
                      ? "Nothing matched just yet."
                      : view === "memory"
                        ? "You can put it down here."
                        : "Room for what matters."
                  }
                  body={
                    query
                      ? "Try a shorter word or part of a name."
                      : view === "memory"
                        ? "Capture a thought, remember a person, or save your place. Your space starts empty."
                        : "Add one responsibility. It doesn’t need a perfect plan."
                  }
                />
              )}
              <div className="secondary-actions">
                {(view === "memory"
                  ? [
                      ["memory", "Save a memory"],
                      ["checkpoint", "Save my place"],
                      ["person", "Add a person"],
                    ]
                  : [
                      ["priority", "Choose a next step"],
                      ["appointment", "Add appointment"],
                      ["handoff", "Share the load"],
                      ["pause", "Pause a decision"],
                      ["return", "Come back gently"],
                    ]
                ).map(([type, label]) => (
                  <button
                    className="small-button"
                    key={type}
                    onClick={() => void openWorkflow(type)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {view === "memory" && state.attachments.length > 0 && (
                <>
                  <h2 className="section-subtitle">Attachments</h2>
                  <p className="help-text">
                    Saved files, not interpreted. Audio has not been
                    transcribed.
                  </p>
                  {state.attachments.map((a: any) => (
                    <div className="schedule-row" key={a.id}>
                      <a href={"/api/attachments/" + a.id} download>
                        {a.name}
                      </a>
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              "Delete this attachment? This cannot be undone.",
                            )
                          )
                            void action(() =>
                              api("/attachments/" + a.id + "/delete", {}),
                            );
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </>
              )}
            </section>
          )}
        </main>
        <footer>
          Less pressure. More room.{" "}
          <span>Beside is practical support, not medical care.</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{toast}</span>
        </div>
      )}
      {modal && (
        <Modal
          onClose={() => setModal(null)}
          title={
            modal.type === "detail"
              ? modal.record!.title
              : modal.type === "all"
                ? "What would help right now?"
                : modal.type === "edit"
                  ? "Make it fit again"
                  : (workflows.find((w) => w[0] === modal.type)?.[1] ??
                    (
                      {
                        capture: "Put it down here",
                        memory: "Something to remember",
                        appointment: "Make room for a date",
                        decision: "Save a decision",
                      } as Record<string, string>
                    )[modal.type] ??
                    "A little help")
          }
        >
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {modal.type === "all" ? (
            <div className="workflow-list">
              {workflows.map(([type, title, desc], i) => (
                <button
                  key={type}
                  onClick={() => {
                    setModal(null);
                    void openWorkflow(type);
                  }}
                >
                  <span className="workflow-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <small>{desc}</small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
          ) : modal.type === "detail" ? (
            <Detail
              record={
                records.find((r) => r.id === modal.record!.id) ?? modal.record!
              }
              settings={settings}
              tool={tool}
              setModal={setModal}
              date={displayDate}
              busy={busy}
              toast={setToast}
            />
          ) : modal.type === "start" ? (
            <StartForm
              records={active}
              submit={(data) => tool("start.help", data)}
              busy={busy}
            />
          ) : modal.type === "capacity" ? (
            <div className="capacity-modal">
              <p>
                You get to say what today feels like. This changes next-step
                recommendations and how many optional nudges arrive.
              </p>
              {[
                [
                  "low",
                  "A little room",
                  "Smaller actions and at most one reminder today.",
                ],
                [
                  "steady",
                  "Some room",
                  "A manageable pace, with your usual reminder budget.",
                ],
                [
                  "room",
                  "More room",
                  "Space for a larger step if you choose one.",
                ],
              ].map(([capacity, title, desc]) => (
                <button
                  className="choice"
                  key={capacity}
                  onClick={() => void tool("capacity.set", { capacity })}
                >
                  <Leaf size={20} />
                  <span>
                    <strong>{title}</strong>
                    <small>{desc}</small>
                  </span>
                </button>
              ))}
              <p className="help-text">
                No sleep or cycle tracking required. Your current report takes
                priority.
              </p>
            </div>
          ) : modal.type === "carry" ? (
            <div>
              <p className="muted-text">
                What are we carrying through? We’ll keep the next step,
                supporting information, and actual outcome together.
              </p>
              <div className="workflow-list">
                {[
                  ["general", "A responsibility"],
                  ["return", "A return or refund"],
                  ["appointment", "An appointment request"],
                  ["form", "A form or application"],
                ].map(([workflow, title]) => (
                  <button
                    key={workflow}
                    onClick={() =>
                      setModal({
                        type: "task",
                        record: { data: { workflow } } as unknown as RecordItem,
                      })
                    }
                  >
                    <span>{title}</span>
                    <ArrowUpRight size={18} />
                  </button>
                ))}
              </div>
            </div>
          ) : modal.type === "transition" ? (
            <TransitionForm
              records={records}
              settings={settings}
              busy={busy}
              submit={(data) => tool("transition.plan", data)}
              checkpoint={() => setModal({ type: "checkpoint" })}
            />
          ) : (
            <RecordForm
              key={modal.type + (modal.record?.id ?? "")}
              kind={
                modal.type === "edit" ? modal.record!.kind : (modal.type as any)
              }
              initial={modal.record}
              initialStatus={modal.status}
              settings={settings}
              records={records}
              busy={busy}
              submit={async (data) => {
                return modal.type === "edit"
                  ? tool("record.update", {
                      id: modal.record!.id,
                      version: modal.record!.version,
                      ...data,
                    })
                  : tool("record.create", { kind: modal.type, ...data });
              }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
function Gate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="gate">
      <img src="/beside.svg" alt="Beside" />
      <h1>{title}</h1>
      {children}
    </div>
  );
}
function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <Sprig />
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}
function Sprig() {
  return (
    <svg
      width="65"
      height="80"
      viewBox="0 0 65 80"
      fill="none"
      aria-hidden="true"
    >
      <path d="M30 75C31 52 44 38 42 8" stroke="#8a9681" strokeWidth="1.6" />
      <path d="M38 47C16 45 11 29 12 22c20 2 28 11 26 25Z" fill="#c6d0bb" />
      <path d="M42 30c1-20 12-22 20-22-1 15-7 22-20 22Z" fill="#aebb9f" />
      <path d="M32 63C17 64 8 56 6 46c17-4 26 2 26 17Z" fill="#d2c9d7" />
    </svg>
  );
}
function StillLife() {
  return (
    <svg
      className="still-life"
      width="170"
      height="190"
      viewBox="0 0 170 190"
      fill="none"
      aria-hidden="true"
    >
      <ellipse cx="87" cy="164" rx="64" ry="10" fill="#ddd5da" opacity=".45" />
      <path
        d="M50 150c-11-3-17-18-15-31 4-23 37-28 51-7 7 11 5 29-5 37-9 6-20 5-31 1Z"
        fill="#b7c1a8"
      />
      <path
        d="M83 101c-7-8-7-25 2-35 15-15 36-4 43 10 8 16 1 30-12 35-13 4-25-1-33-10Z"
        fill="#cbbad0"
      />
      <path
        d="M74 137c-5-13 4-29 16-30 21-2 41 12 39 30-2 18-47 19-55 0Z"
        fill="#e2d4c7"
      />
      <path
        d="M76 50c3-11 11-19 19-23M100 32c-3-12 1-20 6-24M119 44c9-5 17-4 24 0"
        stroke="#a990ad"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M49 83c-12-3-19-10-23-22M28 75c6 0 9 5 11 10"
        stroke="#99a38d"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="142" cy="83" r="3" fill="#c5b8cc" />
      <circle cx="35" cy="39" r="2" fill="#c5b8cc" />
    </svg>
  );
}
function RecordCard({
  record: r,
  onClick,
  date,
}: {
  record: RecordItem;
  onClick: () => void;
  date: (s: string, full?: boolean) => string;
}) {
  const Icon = icons[r.kind] ?? Bookmark;
  return (
    <button className="record-card" onClick={onClick}>
      <div className="record-top">
        <span className={"round-icon " + r.kind}>
          <Icon size={18} />
        </span>
        <span className="status-tag">{r.status}</span>
      </div>
      <h3>{r.title}</h3>
      <p>
        {r.data.nextAction ||
          r.data.body ||
          r.data.outcome ||
          r.data.followUp ||
          r.data.item ||
          r.data.notes ||
          r.data.position ||
          "Saved here for you."}
      </p>
      <div className="record-bottom">
        <span>{labels[r.kind]}</span>
        {r.data.deadline ? (
          <small>
            {r.data.dateKind === "target" ? "Target" : "Deadline"} ·{" "}
            {date(r.data.deadline)}
          </small>
        ) : r.kind === "appointment" ? (
          <small>{date(r.data.startsAt, true)}</small>
        ) : (
          <ChevronRight size={15} />
        )}
      </div>
    </button>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      old?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
function Composer({
  busy,
  mode,
  onSend,
  onFile,
  onError,
}: {
  busy: boolean;
  mode: string;
  onSend: (s: string) => Promise<boolean>;
  onFile: (f: File) => Promise<any>;
  onError: (s: string) => void;
}) {
  const [text, setText] = useState(""),
    [recording, setRecording] = useState(false);
  const file = useRef<HTMLInputElement>(null),
    rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (rec.current?.state === "recording") rec.current.stop();
      rec.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  async function voice() {
    try {
      if (recording) {
        rec.current?.stop();
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm", "audio/ogg", "audio/mp4"].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      if (!mime) {
        stream.getTracks().forEach((t) => t.stop());
        throw Error(
          "This browser cannot save a supported audio format. Use text or attach a recording.",
        );
      }
      const r = new MediaRecorder(stream, { mimeType: mime });
      rec.current = r;
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (timer.current) clearTimeout(timer.current);
        void onFile(
          new File(chunks, "Voice note." + mime.split("/")[1], { type: mime }),
        );
      };
      r.start();
      setRecording(true);
      timer.current = setTimeout(() => r.stop(), 60000);
    } catch (e) {
      onError((e as Error).message);
    }
  }
  return (
    <form
      className="composer"
      onSubmit={async (e) => {
        e.preventDefault();
        if (text.trim() && (await onSend(text))) setText("");
      }}
    >
      <textarea
        aria-label="Message Beside"
        placeholder="Put a thought down. It doesn’t have to be tidy…"
        value={text}
        maxLength={5000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="composer-tools">
        <div>
          <input
            type="file"
            hidden
            ref={file}
            accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.webp,.webm,.ogg,.mp4"
            onChange={(e) => {
              if (e.target.files?.[0]) void onFile(e.target.files[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="icon-button"
            title="Attach a file"
            aria-label="Attach a file"
            onClick={() => file.current?.click()}
          >
            <Paperclip size={19} />
          </button>
          {typeof MediaRecorder !== "undefined" &&
            typeof navigator.mediaDevices?.getUserMedia === "function" && (
              <button
                type="button"
                className="icon-button"
                title="Save audio without transcription"
                aria-label={
                  recording ? "Stop recording" : "Record an audio note"
                }
                onClick={() => void voice()}
              >
                {recording ? <Square size={17} /> : <Mic size={18} />}
              </button>
            )}
          <small>
            {recording
              ? "Recording · up to 60 seconds · no transcription"
              : mode === "none"
                ? "A note, or a guided next step"
                : "One thought at a time"}
          </small>
        </div>
        <button
          className="send"
          disabled={busy || !text.trim()}
          aria-label="Send message"
        >
          {busy ? <span className="spinner" /> : <ArrowUp size={20} />}
        </button>
      </div>
    </form>
  );
}
function StartForm({
  records,
  submit,
  busy,
}: {
  records: RecordItem[];
  submit: (v: any) => Promise<any>;
  busy: boolean;
}) {
  const [obstacle, setObstacle] = useState("big"),
    [taskId, setTaskId] = useState("");
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void submit({
          title: String(f.get("title")),
          obstacle,
          ...(taskId ? { taskId } : {}),
        });
      }}
    >
      <p>
        No need to explain everything. Choose what fits, or skip straight to a
        small step.
      </p>
      <label>
        What are you trying to start?
        <input
          name="title"
          required
          maxLength={240}
          defaultValue={records.find((r) => r.id === taskId)?.title ?? ""}
          key={taskId}
          placeholder="The thing on your mind"
        />
      </label>
      {records.length > 0 && (
        <label>
          Or pick something already held
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">Something new</option>
            {records.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <fieldset>
        <legend>
          What’s in the way? <span className="optional">Optional</span>
        </legend>
        <div className="obstacle-choices">
          {[
            ["unclear", "It’s unclear"],
            ["big", "It feels too big"],
            ["emotional", "It feels difficult"],
            ["low", "I have little capacity"],
          ].map(([value, label]) => (
            <label
              className={
                "radio-choice " + (obstacle === value ? "checked" : "")
              }
              key={value}
            >
              <input
                type="radio"
                name="obstacle"
                value={value}
                checked={obstacle === value}
                onChange={() => setObstacle(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <button className="primary" disabled={busy}>
        Find one first step <ArrowUpRight size={16} />
      </button>
      <button
        className="text-button"
        type="submit"
        onClick={() => setObstacle("big")}
      >
        Skip the question · try one small piece
      </button>
      <p className="help-text">
        You can sit with the first step quietly. No timer required.
      </p>
    </form>
  );
}
function localValue(iso: string | undefined, zone: string) {
  if (!iso) return "";
  try {
    return Temporal.Instant.from(iso)
      .toZonedDateTimeISO(zone)
      .toPlainDateTime()
      .toString()
      .slice(0, 16);
  } catch {
    return "";
  }
}
function RecordForm({
  kind,
  initial,
  initialStatus,
  settings,
  records,
  busy,
  submit,
}: {
  kind: RecordItem["kind"];
  initial?: RecordItem;
  initialStatus?: string;
  settings: Settings;
  records: RecordItem[];
  busy: boolean;
  submit: (data: any) => Promise<any>;
}) {
  const [values, setValues] = useState<Record<string, any>>(() => ({
    ...initial?.data,
  }));
  const [title, setTitle] = useState(initial?.title ?? ""),
    [status, setStatus] = useState(
      initialStatus ??
        initial?.status ??
        (kind === "handoff" ? "proposed" : "active"),
    ),
    [formError, setFormError] = useState("");
  const zone = values.timezone || settings.timezone;
  function field(
    name: string,
    label: string,
    type = "text",
    required = false,
    options?: Array<[string, string]>,
    hint?: string,
  ) {
    const val = values[name] ?? "";
    return (
      <label key={name}>
        {label}
        {!required && <span className="optional">Optional</span>}
        {type === "textarea" ? (
          <textarea
            value={val}
            required={required}
            maxLength={4000}
            onChange={(e) => setValues({ ...values, [name]: e.target.value })}
          />
        ) : options ? (
          <select
            value={val}
            required={required}
            onChange={(e) => setValues({ ...values, [name]: e.target.value })}
          >
            <option value="">Choose…</option>
            {options.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={type}
            required={required}
            maxLength={type === "text" ? 1000 : undefined}
            value={type === "datetime-local" ? localValue(val, zone) : val}
            onChange={(e) => {
              if (type === "datetime-local") {
                try {
                  setValues({
                    ...values,
                    [name]: e.target.value
                      ? localToInstant(e.target.value, zone)
                      : null,
                  });
                  setFormError("");
                } catch (err) {
                  setFormError((err as Error).message);
                }
              } else
                setValues({
                  ...values,
                  [name]:
                    type === "number" ? Number(e.target.value) : e.target.value,
                });
            }}
          />
        )}
        {hint && <small className="help-text">{hint}</small>}
      </label>
    );
  }
  const taskOptions = records
    .filter((r) => r.kind === "task" && r.id !== initial?.id)
    .map((r) => [r.id, r.title] as [string, string]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    let data = { ...values };
    try {
      if (kind === "task") {
        data = {
          ...data,
          workflow: data.workflow || "general",
          dateKind: data.deadline ? data.dateKind || "none" : "none",
          priority: Number(data.priority ?? 1),
          dependencies: data.dependencies ?? [],
        };
      }
      if (kind === "capture") {
        data = {
          ...data,
          body: data.body || title,
          category: data.category || "thought",
        };
        if (data.category === "link") {
          const url = new URL(data.body);
          if (!["https:", "http:"].includes(url.protocol))
            throw Error(
              "Use an http or https link. Links are saved; no website is fetched automatically.",
            );
        }
      }
      if (kind === "memory")
        data = {
          ...data,
          source: data.source ?? "user",
          reviewed: data.reviewed ?? true,
        };
      if (kind === "appointment") data = { ...data, timezone: zone };
      if (kind === "pause") data = { ...data, type: data.type || "purchase" };
      Object.keys(data).forEach((k) => {
        if (
          data[k] === "" &&
          ["taskId", "personId", "appointmentId", "displaces"].includes(k)
        )
          delete data[k];
      });
      await submit({ title, status, data });
    } catch (e) {
      setFormError((e as Error).message);
    }
  }
  return (
    <form className="form" onSubmit={save}>
      <label>
        {kind === "person"
          ? "Name"
          : kind === "capture"
            ? "A short label"
            : kind === "memory"
              ? "What should I remember?"
              : "Give this a name"}
        <input
          required
          maxLength={240}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
      </label>
      {kind === "task" && (
        <>
          {field("workflow", "Kind of responsibility", "text", false, [
            ["general", "Everyday responsibility"],
            ["return", "Return / refund"],
            ["appointment", "Appointment request"],
            ["form", "Form / application"],
          ])}
          {field("nextAction", "One concrete next action", "textarea", true)}
          {field(
            "references",
            "Links, order details, or supporting information",
            "textarea",
          )}
          {field(
            "deadline",
            "Deadline or target",
            "datetime-local",
            false,
            undefined,
            `Time zone: ${settings.timezone}. An unclear date stays a note until you choose.`,
          )}
          {values.deadline &&
            field("dateKind", "What does this date mean?", "text", true, [
              ["real", "A real external deadline"],
              ["target", "A suggested target I can change"],
            ])}
          <div className="form-row">
            {field("effort", "Size of the next step", "text", false, [
              ["small", "Small"],
              ["medium", "Medium"],
              ["large", "Large"],
            ])}
            {field("priority", "Stated priority", "text", false, [
              ["0", "Can wait"],
              ["1", "Normal"],
              ["2", "Important"],
              ["3", "Highest"],
            ])}
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!!values.essential}
              onChange={(e) =>
                setValues({ ...values, essential: e.target.checked })
              }
            />
            Essential responsibility
          </label>
          {field("consequence", "What happens if this waits?", "textarea")}
          {taskOptions.length > 0 && (
            <label>
              Depends on
              <select
                multiple
                aria-label="Dependencies"
                value={values.dependencies ?? []}
                onChange={(e) =>
                  setValues({
                    ...values,
                    dependencies: Array.from(e.target.selectedOptions).map(
                      (o) => o.value,
                    ),
                  })
                }
              >
                {taskOptions.map(([id, t]) => (
                  <option key={id} value={id}>
                    {t}
                  </option>
                ))}
              </select>
              <small>
                Choose only actual dependencies. Ctrl/⌘ click to select or
                clear.
              </small>
            </label>
          )}
          {field("stage", "Current stage")}
          {field("waitingOn", "Waiting on whom or what?")}
          {field(
            "evidence",
            "Actual submission or outcome evidence",
            "textarea",
            false,
            undefined,
            "A confirmation number, date sent, receipt, or your recorded outcome. Prepared is different from submitted.",
          )}
        </>
      )}
      {kind === "capture" && (
        <>
          {field("body", "The thought, text, or link", "textarea", true)}
          {field("category", "Kind of capture", "text", false, [
            ["thought", "Thought"],
            ["note", "Note / selected text"],
            ["link", "Link"],
            ["object", "Physical object location"],
          ])}
          {values.category === "object" &&
            field(
              "location",
              "Where you last put it",
              "text",
              true,
              undefined,
              "This records a place and time. It does not track the object.",
            )}
        </>
      )}
      {kind === "checkpoint" && (
        <>
          {field(
            "taskId",
            "Related responsibility",
            "text",
            false,
            taskOptions,
          )}
          {field("purpose", "What were you trying to do?", "textarea", true)}
          {field("position", "Where are you leaving off?", "textarea", true)}
          {field("decisions", "Decisions already made", "textarea")}
          {field("references", "Relevant links or references", "textarea")}
          {field("nextAction", "The very next action", "textarea", true)}
        </>
      )}
      {kind === "memory" && (
        <>
          {field("body", "What you want held", "textarea", true)}
          {field("source", "Where this came from", "text", false, [
            ["user", "Something I said"],
            ["suggestion", "A suggestion"],
            ["inference", "An uncertain inference"],
          ])}
          {field("sourceRef", "Source or context")}
          {field(
            "expiresAt",
            "Forget this from retrieval after",
            "datetime-local",
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={values.reviewed ?? true}
              onChange={(e) =>
                setValues({ ...values, reviewed: e.target.checked })
              }
            />
            I have reviewed this statement
          </label>
          <p className="help-text">
            Inferences stay labeled. Expired memories remain visible here until
            you delete them.
          </p>
        </>
      )}
      {kind === "person" && (
        <>
          {field("context", "Context you choose to remember", "textarea")}
          {field("followUp", "What did you mean to follow up on?", "textarea")}
          {field("followUpAt", "A time to revisit", "datetime-local")}
          {field("lastContact", "Last actual contact", "datetime-local")}
          <p className="help-text">
            Only what you record is kept. Beside doesn’t monitor relationships
            or guess how someone feels.
          </p>
        </>
      )}
      {kind === "handoff" && (
        <>
          {field("outcome", "The complete desired outcome", "textarea", true)}
          {field("owner", "Who will own this?", "text", true)}
          {field("deadline", "Agreed deadline", "datetime-local")}
          {field(
            "information",
            "Everything they need to take it on",
            "textarea",
          )}
          {field(
            "agreement",
            "Their actual agreement",
            "textarea",
            false,
            undefined,
            "Leave blank until they have agreed. A copied handoff is still only proposed.",
          )}
          {field("evidence", "Completion evidence", "textarea")}
        </>
      )}
      {kind === "pause" && (
        <>
          {field("type", "A pause before…", "text", true, [
            ["purchase", "A purchase"],
            ["commitment", "A new commitment"],
            ["reply", "An emotionally charged reply"],
          ])}
          {field(
            "item",
            "The item, commitment, or unsent reply",
            "textarea",
            true,
          )}
          {field(
            "constraint",
            "A constraint you want to honor",
            "textarea",
            false,
            undefined,
            "Your budget, time, energy, or something else that matters to you.",
          )}
          {field(
            "reviewAt",
            "When would you like to review it?",
            "datetime-local",
            true,
          )}
          {field(
            "displaces",
            "Which existing responsibility might this displace?",
            "text",
            false,
            taskOptions,
          )}
          {field("decision", "Your eventual decision", "textarea")}
          <p className="help-text">
            You remain free to proceed. Nothing is bought, sent, or locked.
          </p>
        </>
      )}
      {kind === "appointment" && (
        <>
          {field(
            "timezone",
            "Time zone",
            "text",
            false,
            undefined,
            "Use an IANA name, such as America/New_York or Europe/London.",
          )}
          {field("startsAt", "Starts", "datetime-local", true)}
          {field("endsAt", "Ends", "datetime-local", true)}
          {field("location", "Location or meeting link")}
          {field("notes", "Anything you need to know", "textarea")}
        </>
      )}
      {kind === "draft" && (
        <>
          {field("body", "Editable draft", "textarea", true)}
          <p className="help-text">
            Copy this and send it yourself. Editing here does not send anything.
          </p>
        </>
      )}
      {kind === "decision" && (
        <>
          {field("question", "The decision", "textarea", true)}
          {field("choice", "What you chose", "textarea", true)}
        </>
      )}
      {kind === "transition" && (
        <>
          <p>
            To recalculate the full plan, create a new transition from the saved
            checkpoint. Pause the old plan to cancel its reminder.
          </p>
          {field("evidence", "What actually happened?", "textarea")}
        </>
      )}
      {initial?.id && (
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {(kind === "handoff"
              ? ["proposed", "accepted", "completed", "paused", "dropped"]
              : kind === "task" && values.workflow !== "general"
                ? [
                    "active",
                    "prepared",
                    "submitted",
                    "waiting",
                    "blocked",
                    "paused",
                    "failed",
                    "confirmed",
                    "completed",
                    "dropped",
                  ]
                : [
                    "active",
                    "waiting",
                    "blocked",
                    "paused",
                    "failed",
                    "completed",
                    "dropped",
                  ]
            ).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}
      {formError && (
        <p className="error" role="alert">
          {formError}
        </p>
      )}
      <div className="form-footer">
        <span>
          <ShieldCheck size={14} />
          Saved in your space
        </span>
        <button className="primary" disabled={busy || !!formError}>
          Save {kind === "checkpoint" ? "my place" : ""}
          <Check size={16} />
        </button>
      </div>
    </form>
  );
}
function TransitionForm({
  records,
  settings,
  submit,
  checkpoint,
  busy,
}: {
  records: RecordItem[];
  settings: Settings;
  submit: (data: any) => Promise<any>;
  checkpoint: () => void;
  busy: boolean;
}) {
  const checkpoints = records.filter((r) => r.kind === "checkpoint"),
    appointments = records.filter((r) => r.kind === "appointment");
  const [appointmentId, setAppointment] = useState("");
  const appointment = appointments.find((r) => r.id === appointmentId);
  const [error, setError] = useState("");
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          const data = {
            title: String(f.get("title")),
            checkpointId: String(f.get("checkpointId")),
            localTime: String(f.get("localTime")),
            timezone: String(f.get("timezone")),
            preparation: Number(f.get("preparation")),
            windDown: Number(f.get("windDown")),
            travel: Number(f.get("travel")),
            buffer: Number(f.get("buffer")),
            ...(appointmentId ? { appointmentId } : {}),
          };
          localToInstant(data.localTime, data.timezone);
          void submit(data);
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <p>
        First, leave yourself a thread. Then we’ll plan backward using your
        estimates.
      </p>
      {!checkpoints.length ? (
        <>
          <p>
            Save your current purpose, position, and next action before making a
            transition plan.
          </p>
          <button className="primary" type="button" onClick={checkpoint}>
            Save my place first
          </button>
        </>
      ) : (
        <>
          <label>
            Your saved place
            <select name="checkpointId" required>
              {checkpoints.map((r) => (
                <option value={r.id} key={r.id}>
                  {r.title} · {r.data.nextAction}
                </option>
              ))}
            </select>
          </label>
          <label>
            Use an appointment
            <select
              value={appointmentId}
              onChange={(e) => setAppointment(e.target.value)}
            >
              <option value="">Another commitment</option>
              {appointments.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Commitment name
            <input
              required
              name="title"
              defaultValue={appointment?.title ?? ""}
              key={"title" + appointmentId}
            />
          </label>
          <label>
            Commitment time
            <input
              name="localTime"
              type="datetime-local"
              required
              defaultValue={localValue(
                appointment?.data.startsAt,
                appointment?.data.timezone ?? settings.timezone,
              )}
              key={"time" + appointmentId}
            />
          </label>
          <label>
            Time zone
            <input
              name="timezone"
              required
              defaultValue={appointment?.data.timezone ?? settings.timezone}
              key={"zone" + appointmentId}
            />
          </label>
          <div className="form-row">
            {[
              ["windDown", "Wind down", 5],
              ["preparation", "Get ready", 10],
              ["travel", "Travel estimate", 15],
              ["buffer", "Arrival buffer", 5],
            ].map(([name, label, value]) => (
              <label key={name}>
                {" "}
                {label} (min)
                <input
                  name={String(name)}
                  type="number"
                  min="0"
                  max={name === "travel" ? 1440 : 240}
                  required
                  defaultValue={value}
                />
              </label>
            ))}
          </div>
          <p className="help-text">
            Travel is your estimate, not a live service. An alert never marks
            you as having left or arrived.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            Make my transition plan <ArrowUpRight size={16} />
          </button>
        </>
      )}
    </form>
  );
}
function Detail({
  record: r,
  settings,
  tool,
  setModal,
  date,
  busy,
  toast,
}: {
  record: RecordItem;
  settings: Settings;
  tool: (name: ToolName, input: any, close?: boolean) => Promise<any>;
  setModal: (m: ModalState | null) => void;
  date: (s: string, full?: boolean) => string;
  busy: boolean;
  toast: (s: string) => void;
}) {
  const [next, setNext] = useState(""),
    [history, setHistory] = useState<any[] | null>(null),
    [reminder, setReminder] = useState(""),
    [localError, setError] = useState("");
  async function copy() {
    const body =
      r.kind === "handoff"
        ? `Outcome: ${r.data.outcome}\nOwner: ${r.data.owner}\nDeadline: ${r.data.deadline ? date(r.data.deadline, true) : "To agree"}\nInformation: ${r.data.information}\nStatus: ${r.status} (agreement is not assumed)`
        : r.data.body || r.data.message || r.data.item || r.data.nextAction;
    try {
      await navigator.clipboard.writeText(body);
      toast("Copied. Nothing has been sent.");
    } catch {
      setError("Clipboard is unavailable. Select and copy the text above.");
    }
  }
  function status(s: string) {
    if (
      (r.kind === "task" &&
        r.data.workflow !== "general" &&
        ["submitted", "waiting", "confirmed", "completed"].includes(s)) ||
      (r.kind === "handoff" && ["accepted", "completed"].includes(s)) ||
      (r.kind === "transition" && s === "completed")
    ) {
      setModal({ type: "edit", record: r, status: s });
      return;
    }
    void tool(
      "record.update",
      { id: r.id, version: r.version, status: s },
      false,
    );
  }
  return (
    <div className="detail">
      <div className="detail-meta">
        <span className="status-tag">{r.status}</span>
        <span>{labels[r.kind]}</span>
        <span>Saved {date(r.updatedAt, true)}</span>
      </div>
      {r.kind === "capture" && r.data.category === "object" && (
        <div className="result-panel">
          Last recorded at {date(r.updatedAt, true)}:{" "}
          <strong>{r.data.location}</strong>. This is not live tracking.
        </div>
      )}
      <dl>
        {Object.entries(r.data)
          .filter(
            ([key, value]) =>
              value !== "" &&
              value !== null &&
              value !== undefined &&
              ![
                "convertedTaskId",
                "sent",
                "calendarUid",
                "travelSource",
              ].includes(key),
          )
          .map(([key, value]) => (
            <div key={key}>
              <dt>
                {{
                  nextAction: "Next action",
                  dateKind: "Kind of date",
                  waitingOn: "Waiting on",
                  sourceRef: "Source",
                  reviewAt: "Review at",
                  followUpAt: "Follow up at",
                  startsAt: "Starts",
                  endsAt: "Ends",
                  startAt: "Begin winding down",
                  leaveAt: "Leave at",
                  commitmentAt: "Commitment time",
                  windDown: "Wind down (minutes)",
                  preparation: "Get ready (minutes)",
                  travel: "Travel estimate (minutes)",
                  buffer: "Arrival buffer (minutes)",
                }[key] ?? key.replace(/([A-Z])/g, " $1")}
              </dt>
              <dd>
                {typeof value === "boolean"
                  ? value
                    ? "Yes"
                    : "No"
                  : typeof value === "string" &&
                      /^\d{4}-\d{2}-\d{2}T/.test(value)
                    ? date(value, true) + " · " + settings.timezone
                    : Array.isArray(value)
                      ? value.length
                        ? value.join(", ")
                        : "None"
                      : String(value)}
              </dd>
            </div>
          ))}
      </dl>
      {r.kind === "task" && (
        <div className="inline-actions">
          <button
            onClick={() => void tool("priority.next", { overrideId: r.id })}
          >
            Make this my next step
          </button>
          <button onClick={() => void tool("priority.next", { rest: true })}>
            Rest for now
          </button>
          {r.data.workflow !== "general" && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void tool("workflow.draft", { id: r.id })}
            >
              Prepare a draft
            </button>
          )}
          {r.data.workflow !== "general" && (
            <button onClick={() => status("submitted")}>
              Record submission
            </button>
          )}
          <button
            onClick={() =>
              status(r.data.workflow !== "general" ? "confirmed" : "completed")
            }
          >
            {r.data.workflow !== "general"
              ? "Confirm outcome"
              : "Mark complete"}
          </button>
          <button onClick={() => status("waiting")}>Waiting on someone</button>
        </div>
      )}
      {r.kind === "task" && r.data.obstacle && (
        <button
          className="small-button"
          onClick={() =>
            void tool(
              "start.help",
              {
                taskId: r.id,
                title: r.title,
                obstacle: r.data.obstacle,
                helpful: true,
              },
              false,
            )
          }
        >
          <Heart size={15} />
          This approach helped · remember it
        </button>
      )}
      {r.kind === "capture" && (
        <form
          className="form inset"
          onSubmit={(e) => {
            e.preventDefault();
            void tool("capture.toTask", { id: r.id, nextAction: next });
          }}
        >
          <label>
            Turn this into a responsibility
            <input
              placeholder="One concrete next action"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            Make it a responsibility
          </button>
        </form>
      )}
      {r.kind === "person" && (
        <div className="inline-actions">
          <button
            className="primary"
            onClick={() =>
              void tool("people.draft", { id: r.id, delayed: false })
            }
          >
            Draft a message
          </button>
          <button
            onClick={() =>
              void tool("people.draft", { id: r.id, delayed: true })
            }
          >
            Help with a delayed reply
          </button>
        </div>
      )}
      {r.kind === "handoff" && (
        <div className="inline-actions">
          <button onClick={() => status("accepted")}>
            Record their agreement
          </button>
          <button onClick={() => status("completed")}>Record completion</button>
        </div>
      )}
      {r.kind === "transition" && (
        <div className="inline-actions">
          <button className="primary" onClick={() => status("completed")}>
            Record what happened
          </button>
          <button
            onClick={() => {
              void tool(
                "record.update",
                { id: r.id, version: r.version, status: "paused" },
                false,
              ).then((result) => {
                if (result) setModal({ type: "transition" });
              });
            }}
          >
            Plan changed · recalculate
          </button>
        </div>
      )}
      {r.kind === "pause" && (
        <div className="inline-actions">
          <button
            onClick={() =>
              setModal({ type: "edit", record: r, status: "completed" })
            }
          >
            Review and decide
          </button>
          <button onClick={() => setModal({ type: "edit", record: r })}>
            Give it more time
          </button>
        </div>
      )}
      {["draft", "handoff", "pause"].includes(r.kind) && (
        <button className="small-button" onClick={() => void copy()}>
          Copy for my own handoff
        </button>
      )}
      {!finish.has(r.status) && (
        <div className="inline-actions">
          <button
            onClick={() => status(r.status === "paused" ? "active" : "paused")}
          >
            {r.status === "paused" ? "Resume" : "Pause this"}
          </button>
          <button onClick={() => status("dropped")}>Let this go</button>
          <button onClick={() => setModal({ type: "edit", record: r })}>
            Edit / reschedule
          </button>
        </div>
      )}
      {finish.has(r.status) && (
        <button
          onClick={() => status(r.kind === "handoff" ? "proposed" : "active")}
        >
          Reopen
        </button>
      )}
      <div className="inline-actions">
        <button
          className="text-button"
          onClick={() => void tool("record.undo", { id: r.id }, false)}
        >
          <Undo2 size={15} />
          Undo last change
        </button>
        <button
          className="text-button"
          onClick={async () => {
            try {
              const h = await api("/history/" + r.id);
              setHistory(h.events);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          View history
        </button>
        <button
          className="text-button"
          onClick={() => {
            if (
              confirm(
                "Forget this item? Its search and event history will be removed. Conversation history is also cleared so it cannot retain copies. This cannot be undone.",
              )
            )
              void tool("record.delete", { id: r.id, confirm: true });
          }}
        >
          Forget
        </button>
      </div>
      {history && (
        <ul className="history">
          {history.map((e) => (
            <li key={e.id}>
              {e.action} · {date(e.created_at, true)}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary>Choose a reminder</summary>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              void tool(
                "reminder.schedule",
                {
                  recordId: r.id,
                  at: localToInstant(reminder, settings.timezone),
                },
                false,
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <label>
            Review time
            <input
              type="datetime-local"
              value={reminder}
              onChange={(e) => setReminder(e.target.value)}
              required
            />
          </label>
          <small>{settings.timezone} · quiet hours and budget apply.</small>
          <button>Save reminder</button>
        </form>
      </details>
      {localError && (
        <p role="alert" className="error">
          {localError}
        </p>
      )}
    </div>
  );
}
function SettingsView({
  state,
  save,
  action,
  refresh,
  toast,
  error,
}: {
  state: any;
  save: (s: Partial<Settings>) => Promise<any>;
  action: (fn: () => Promise<any>) => Promise<any>;
  refresh: () => Promise<any>;
  toast: (s: string) => void;
  error: (s: string) => void;
}) {
  const s: Settings = state.settings;
  const [models, setModels] = useState<any[]>([]),
    [deleteText, setDeleteText] = useState("");
  const importFile = useRef<HTMLInputElement>(null);
  const p = state.providers.plan;
  async function loadModels() {
    const r = await action(() => api("/plan/models"));
    if (r) setModels(r.models);
  }
  return (
    <section className="secondary settings-page">
      <div className="eyebrow">YOUR SPACE, YOUR CHOICE</div>
      <h1>Make room for you.</h1>
      <p className="intro">Change what helps. Leave the rest.</p>
      <section className="settings-section">
        <h2>How we work together</h2>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void save({
              name: String(f.get("name")),
              timezone: String(f.get("timezone")),
              tone: String(f.get("tone")) as any,
            });
          }}
        >
          <div className="form-row">
            <label>
              What should I call you?
              <input
                name="name"
                defaultValue={s.name}
                maxLength={60}
                placeholder="Optional"
              />
            </label>
            <label>
              Time zone
              <input name="timezone" required defaultValue={s.timezone} />
            </label>
          </div>
          <label>
            Tone
            <select name="tone" defaultValue={s.tone}>
              <option value="warm">Warm and practical</option>
              <option value="concise">Short and direct</option>
            </select>
          </label>
          <button className="small-button">Save preferences</button>
        </form>
        <p className="help-text">
          Time-zone changes preserve the actual time of existing commitments.
          Edit a commitment if you mean to move it. Ambiguous daylight-saving
          times need clarification.
        </p>
      </section>
      <section className="settings-section">
        <div className="section-title">
          <h2>Your kind of help</h2>
          <span className="status-tag">
            {s.mode === "none"
              ? "No AI active"
              : s.mode === "plan"
                ? "ChatGPT plan active"
                : "Paid API active"}
          </span>
        </div>
        <div className="mode-option">
          <div>
            <h3>No-AI mode</h3>
            <p>
              All ten guided workflows, memory search, drafts, scheduling, and
              calendar files. No model, embedding, or transcription requests.
            </p>
          </div>
          <button
            className={
              s.mode === "none" ? "small-button selected" : "small-button"
            }
            onClick={() => void save({ mode: "none" })}
          >
            {s.mode === "none" ? "Using this" : "Use No-AI"}
          </button>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={s.permissions.ai}
            onChange={(e) =>
              void save({
                permissions: { ...s.permissions, ai: e.target.checked },
                ...(!e.target.checked ? { mode: "none" as const } : {}),
              })
            }
          />
          Allow AI requests when I explicitly enable an AI mode
        </label>
        <div className="provider-card">
          <div className="section-title">
            <h3>Use your ChatGPT plan</h3>
            <span className="status-tag">{p.state}</span>
          </div>
          <p>
            Uses your existing plan allowance. Identity sign-in and permission
            to use the plan are separate. Beside does not receive your ChatGPT
            history or memories.
          </p>
          {p.available ? (
            <>
              <p className="help-text">
                For eligible personal open-source installations and accounts.
                Each account has a separate saved profile after the first.
                Approval or an open-source eligible edition is required; source
                in this private repository alone does not establish eligibility.
              </p>
              <>
                {p.eligible ? (
                  <a className="primary link-button" href="/api/plan/authorize">
                    Continue with ChatGPT <ArrowUpRight size={16} />
                  </a>
                ) : (
                  <div className="connection-note">
                    <ShieldCheck size={18} />
                    <p>
                      {p.reason} Follow docs/CHATGPT.md and set
                      BESIDE_PLAN_ELIGIBLE=true only after confirming
                      eligibility.
                    </p>
                  </div>
                )}
              </>
              {p.accounts?.length > 0 && (
                <>
                  <label>
                    Saved account
                    <select
                      aria-label="Saved ChatGPT account"
                      value={p.activeId ?? ""}
                      onChange={async (e) => {
                        setModels([]);
                        await action(() =>
                          api("/plan/select", {
                            id: e.target.value || undefined,
                          }),
                        );
                      }}
                    >
                      <option value="">
                        Personal profile · no selected account
                      </option>
                      {p.accounts.map((a: any) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                          {a.signedIn ? "" : " · signed out"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {p.activeId && (
                    <div className="inline-actions">
                      <a
                        className="small-button"
                        href={
                          "/api/plan/authorize?registration=" +
                          encodeURIComponent(p.activeId)
                        }
                      >
                        Reauthorize this account
                      </a>
                      <button
                        onClick={async () => {
                          const r = await action(() =>
                            api("/plan/signout", {}),
                          );
                          if (r) toast(r.message);
                        }}
                      >
                        Sign out of ChatGPT
                      </button>
                    </div>
                  )}
                </>
              )}
              {p.planAllowed && (
                <>
                  <button
                    className="small-button"
                    onClick={() => void loadModels()}
                  >
                    Load my available models
                  </button>
                  {models.length > 0 && (
                    <label>
                      Model
                      <select
                        value={p.model ?? ""}
                        onChange={(e) =>
                          void action(() =>
                            api("/plan/model", { model: e.target.value }),
                          )
                        }
                      >
                        <option value="">Choose your model</option>
                        {models.map((m) => (
                          <option key={m.slug} value={m.slug}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    className="primary"
                    disabled={!s.permissions.ai || !p.model}
                    onClick={() => void save({ mode: "plan" })}
                  >
                    Use my ChatGPT plan
                  </button>
                </>
              )}
              {!p.planAllowed && p.state === "connected" && (
                <p className="help-text">
                  Identity is connected, but plan permission is missing.
                  Reauthorize and review “Use your ChatGPT plan.”
                </p>
              )}
            </>
          ) : (
            <div className="connection-note">
              <ShieldCheck size={18} />
              <p>{p.reason} Your No-AI companion is fully available here.</p>
            </div>
          )}
          <p className="help-text">
            In{" "}
            <a
              href="https://chatgpt.com/#settings/Usage"
              target="_blank"
              rel="noreferrer"
            >
              ChatGPT Settings → Usage
            </a>
            , set Beside’s weekly app limit and turn off “Allow other apps to
            use credits after reaching your usage limit” if you want a plan-only
            limit. Beside cannot change these billing settings.
          </p>
        </div>
        <div className="provider-card">
          <div className="section-title">
            <h3>Separately billed API</h3>
            <span className="status-tag">{state.providers.api.state}</span>
          </div>
          <p>
            Optional and off by default. Configure a server-side{" "}
            <code>BESIDE_API_KEY</code> to enable it. This is separate from a
            ChatGPT subscription. It is never used as an automatic fallback.
          </p>
          <button
            className="small-button"
            disabled={
              !s.permissions.ai || state.providers.api.state !== "connected"
            }
            onClick={() => {
              if (
                confirm(
                  "Enable separately billed API requests? Your provider will bill your API account independently from your ChatGPT plan.",
                )
              )
                void save({ mode: "api" });
            }}
          >
            Enable separately billed API
          </button>
        </div>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void save({
              apiDailyRequests: Number(f.get("requests")),
              apiMaxOutput: Number(f.get("output")),
            });
          }}
        >
          <div className="form-row">
            <label>
              Daily AI request cap
              <input
                type="number"
                name="requests"
                min="1"
                max="50"
                defaultValue={s.apiDailyRequests}
              />
            </label>
            <label>
              API output token cap
              <input
                type="number"
                name="output"
                min="128"
                max="2048"
                defaultValue={s.apiMaxOutput}
              />
            </label>
          </div>
          <small>
            Request cap applies to both AI modes, resets at UTC midnight, and
            includes failed attempts. Plan preview forbids output-token caps;
            its responses use a 60-second timeout and a bounded stream. No
            background model calls.
          </small>
          <button className="small-button">Save usage limits</button>
        </form>
      </section>
      <section className="settings-section">
        <h2>Gentle reminders</h2>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void save({
              remindersEnabled: f.has("enabled"),
              quietEnabled: f.has("quiet"),
              quietStart: Number(f.get("start")),
              quietEnd: Number(f.get("end")),
              urgencyExceptions: f.has("urgent"),
              notificationBudget: Number(f.get("budget")),
              monitoring: f.getAll("monitor") as any,
            });
          }}
        >
          <label className="checkbox">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={s.remindersEnabled}
            />
            Scheduled reminders enabled
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              name="quiet"
              defaultChecked={s.quietEnabled}
            />
            Respect quiet hours
          </label>
          <div className="form-row">
            <label>
              Quiet from (0–23)
              <input
                type="number"
                name="start"
                min="0"
                max="23"
                defaultValue={s.quietStart}
              />
            </label>
            <label>
              Until (0–23)
              <input
                type="number"
                name="end"
                min="0"
                max="23"
                defaultValue={s.quietEnd}
              />
            </label>
            <label>
              Reminders per day
              <input
                type="number"
                name="budget"
                min="0"
                max="8"
                defaultValue={s.notificationBudget}
              />
            </label>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              name="urgent"
              defaultChecked={s.urgencyExceptions}
            />
            Allow essential reminders during quiet hours
          </label>
          <fieldset>
            <legend>What may be monitored?</legend>
            {[
              ["task", "Responsibility deadlines and waiting"],
              ["person", "People follow-ups I choose"],
              ["pause", "My paused decisions"],
              ["transition", "Transition plans"],
              ["appointment", "Appointments"],
            ].map(([kind, label]) => (
              <label className="checkbox" key={kind}>
                <input
                  type="checkbox"
                  name="monitor"
                  value={kind}
                  defaultChecked={s.monitoring.includes(kind as any)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <button className="small-button">Save reminder preferences</button>
        </form>
        <div className="inline-actions">
          <button
            onClick={() =>
              void save({
                pausedUntil: new Date(Date.now() + 86400000).toISOString(),
              })
            }
          >
            Pause reminders for a day
          </button>
          {s.pausedUntil && (
            <button onClick={() => void save({ pausedUntil: null })}>
              Resume reminders
            </button>
          )}
          <button
            onClick={async () => {
              if (!("Notification" in window)) {
                error(
                  "This browser does not support notifications. The inbox is always available.",
                );
                return;
              }
              const permission = await Notification.requestPermission();
              toast(
                permission === "granted"
                  ? "Browser notifications enabled while Beside is open."
                  : "The in-app inbox remains available.",
              );
            }}
          >
            Allow browser notifications
          </button>
        </div>
        <p className="help-text">
          Closed-browser push is unavailable. Notifications require an open page
          and permission; the local server or Cloudflare worker must run to save
          scheduled inbox reminders. Low-capacity days reduce the daily budget
          to at most one.
        </p>
      </section>
      <section className="settings-section">
        <h2>Calendar files</h2>
        <p>
          Import individual timed appointments from an .ics file, or export your
          saved appointments. Recurring and all-day events require a specific
          occurrence or time.
        </p>
        <input
          ref={importFile}
          type="file"
          accept=".ics,text/calendar"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              const content = await f.text();
              const r = await action(() =>
                api("/calendar/import", { content }),
              );
              if (r) toast(r.message);
            }
            e.target.value = "";
          }}
        />
        <div className="inline-actions">
          <button
            className="small-button"
            onClick={() => importFile.current?.click()}
          >
            Import calendar file
          </button>
          <a href="/api/calendar/export" className="small-button" download>
            Export appointments <Download size={15} />
          </a>
        </div>
        <p className="help-text">
          Live calendar and email connections: unconfigured. Messages, bookings,
          returns, and invitations use an explicit handoff to you; no external
          sending is enabled.
        </p>
      </section>
      <section className="settings-section">
        <h2>Permissions & your data</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={s.permissions.internal}
            onChange={(e) =>
              void save({
                permissions: { ...s.permissions, internal: e.target.checked },
              })
            }
          />
          Allow guided tools to edit internal records and reminders
        </label>
        <p>
          External communications and spending are not enabled. AI proposals
          require your review. File contents cannot authorize actions or change
          permissions.
        </p>
        <a href="/api/export" className="small-button" download>
          Export my data <Download size={15} />
        </a>
        <p className="help-text">
          Exports contain your private content and attachments, never provider
          credentials. Forgetting an item removes it from search, event history,
          and future AI context; conversation history is also cleared to remove
          copies. Downloaded exports and any operator-created backups are
          outside the app’s control. Cloudflare may retain storage history for
          its configured recovery period; see the deployment privacy guide.
        </p>
        <details className="delete-section">
          <summary>Delete everything in this profile</summary>
          <p>
            This removes saved items, attachments, conversation, reminders, and
            history. It cannot be undone. Connected provider registrations are
            separate; sign out of ChatGPT above to clear its tokens.
          </p>
          <label>
            Type DELETE to confirm
            <input
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
            />
          </label>
          <button
            disabled={deleteText !== "DELETE"}
            onClick={async () => {
              const r = await action(() =>
                api("/delete-all", { confirm: deleteText }),
              );
              if (r) {
                setDeleteText("");
                toast("This profile’s content has been deleted.");
              }
            }}
          >
            Delete this profile’s data
          </button>
        </details>
        {!state.local && (
          <button
            className="text-button"
            onClick={async () => {
              await api("/logout", {});
              await refresh();
            }}
          >
            <LogOut size={15} />
            Lock my space
          </button>
        )}
      </section>
    </section>
  );
}
