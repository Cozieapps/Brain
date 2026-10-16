import { useState } from "react";
import {
  Bell,
  Check,
  ChevronDown,
  Pause,
  Play,
  Plus,
  Sparkles,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import type { CheckIn, Note, Reminder, Task } from "../lib/db";
import type { TimerState } from "../lib/settings";

export interface TodayProps {
  tasks: Task[];
  reminders: Reminder[];
  notes: Note[];
  lastCheckIn?: CheckIn;
  timer: TimerState | null;
  now: number;
  onAddTask(title: string): void;
  onToggleTask(task: Task): void;
  onToggleStep(task: Task, index: number): void;
  onDeleteTask(task: Task): void;
  onStartTimer(minutes: number, label: string): void;
  onStopTimer(): void;
  onAsk(prompt: string): void;
  onCheckIn(energy: CheckIn["energy"], cycle?: CheckIn["cycle"]): void;
  onDeleteReminder(r: Reminder): void;
  onDeleteNote(n: Note): void;
  onClose?: () => void;
}

const ENERGY: { value: CheckIn["energy"]; label: string }[] = [
  { value: 1, label: "Empty" },
  { value: 2, label: "Low" },
  { value: 3, label: "Okay" },
  { value: 4, label: "Good" },
  { value: 5, label: "Wired" },
];

export function Today(props: TodayProps) {
  const open = props.tasks.filter((t) => !t.done);
  const doneToday = props.tasks.filter(
    (t) =>
      t.done &&
      t.doneAt &&
      new Date(t.doneAt).toDateString() === new Date(props.now).toDateString(),
  );
  const focus = open.find((t) => t.pinned) ?? open[0];
  const upcoming = props.reminders
    .filter((r) => !r.fired)
    .sort((a, b) => a.at.localeCompare(b.at));
  return (
    <div className="today" aria-label="Today">
      <div className="today-head">
        <h2>Today</h2>
        {props.onClose && (
          <button
            className="icon ghost"
            aria-label="Close today panel"
            onClick={props.onClose}
          >
            <X size={18} />
          </button>
        )}
      </div>
      <TimerCard {...props} />
      {focus && (
        <section className="card one-thing">
          <div className="eyebrow">
            <Sparkles size={14} /> One thing now
          </div>
          <p className="one-title">{focus.title}</p>
          {focus.steps.find((s) => !s.done) && (
            <p className="one-step">
              Next: {focus.steps.find((s) => !s.done)!.text}
            </p>
          )}
          <div className="row">
            <button
              className="primary small"
              onClick={() => props.onStartTimer(10, focus.title)}
            >
              <Play size={14} /> 10 minutes on this
            </button>
            <button
              className="small"
              onClick={() => props.onAsk(`Help me start: ${focus.title}`)}
            >
              Help me start
            </button>
          </div>
        </section>
      )}
      <TaskList {...props} open={open} />
      {doneToday.length > 0 && (
        <p className="done-count">
          <Check size={14} /> {doneToday.length} done today. That counts.
        </p>
      )}
      <CheckInCard {...props} />
      {upcoming.length > 0 && (
        <section className="card">
          <h3>
            <Bell size={15} /> Reminders
          </h3>
          <ul className="plain">
            {upcoming.map((r) => (
              <li key={r.id} className="line">
                <span className="time">
                  {new Date(r.at).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <span className="grow">{r.text}</span>
                <button
                  className="icon ghost"
                  aria-label={`Delete reminder ${r.text}`}
                  onClick={() => props.onDeleteReminder(r)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {props.notes.length > 0 && (
        <details className="card notes">
          <summary>
            <h3>
              <StickyNote size={15} /> Notes &amp; brain dump{" "}
              <span className="count">{props.notes.length}</span>
            </h3>
            <ChevronDown size={16} />
          </summary>
          <ul className="plain">
            {[...props.notes].reverse().map((n) => (
              <li key={n.id} className="line">
                <span className="grow">{n.text}</span>
                <button
                  className="icon ghost"
                  aria-label="Delete note"
                  onClick={() => props.onDeleteNote(n)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
          <button
            className="small"
            onClick={() =>
              props.onAsk(
                "Sort my brain dump notes into a few tasks and tell me which one to do first.",
              )
            }
          >
            Sort these into tasks
          </button>
        </details>
      )}
    </div>
  );
}

function TimerCard({ timer, now, onStartTimer, onStopTimer }: TodayProps) {
  if (!timer)
    return (
      <section className="card timer idle">
        <h3>Focus timer</h3>
        <p className="muted">
          A visible clock helps with time blindness. Beside will check in
          halfway.
        </p>
        <div className="row wrap">
          {[5, 15, 25, 45].map((m) => (
            <button
              key={m}
              className="small"
              onClick={() => onStartTimer(m, "Focus")}
            >
              {m} min
            </button>
          ))}
        </div>
      </section>
    );
  const total = timer.endsAt - timer.startedAt;
  const left = Math.max(0, timer.endsAt - now);
  const fraction = total > 0 ? left / total : 0;
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <section className="card timer running" aria-live="off">
      <div
        className="ring"
        role="timer"
        aria-label={`${mins} minutes ${secs} seconds left`}
      >
        <svg viewBox="0 0 100 100" width="104" height="104" aria-hidden>
          <circle cx="50" cy="50" r={r} className="track" />
          <circle
            cx="50"
            cy="50"
            r={r}
            className="fill"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - fraction)}
          />
        </svg>
        <span className="clock">
          {left === 0 ? "Done" : `${mins}:${String(secs).padStart(2, "0")}`}
        </span>
      </div>
      <div className="grow">
        <div className="eyebrow">Focusing on</div>
        <p className="one-title">{timer.label}</p>
        <p className="muted">
          Ends at{" "}
          {new Date(timer.endsAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
        <button className="small" onClick={onStopTimer}>
          <Pause size={14} /> {left === 0 ? "Clear" : "Stop"}
        </button>
      </div>
    </section>
  );
}

function TaskList(props: TodayProps & { open: Task[] }) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section className="card">
      <h3>To do</h3>
      <form
        className="add-task"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          props.onAddTask(draft.trim());
          setDraft("");
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add something…"
          aria-label="New task"
        />
        <button className="icon" aria-label="Add task" disabled={!draft.trim()}>
          <Plus size={16} />
        </button>
      </form>
      {props.open.length === 0 ? (
        <p className="muted">
          Nothing here yet. Tell Beside what's on your mind and it can sort it
          for you.
        </p>
      ) : (
        <ul className="plain tasks">
          {props.open.map((t) => (
            <li key={t.id}>
              <div className="line">
                <button
                  className="check"
                  aria-label={`Mark ${t.title} done`}
                  onClick={() => props.onToggleTask(t)}
                />
                <button
                  className="task-title"
                  aria-expanded={expanded === t.id}
                  onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                >
                  {t.title}
                  {t.steps.length > 0 && (
                    <span className="count">
                      {t.steps.filter((s) => s.done).length}/{t.steps.length}
                    </span>
                  )}
                </button>
                <button
                  className="icon ghost"
                  aria-label={`Delete ${t.title}`}
                  onClick={() => props.onDeleteTask(t)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {expanded === t.id && (
                <div className="steps">
                  {t.steps.map((s, i) => (
                    <label key={i} className={s.done ? "step done" : "step"}>
                      <input
                        type="checkbox"
                        checked={s.done}
                        onChange={() => props.onToggleStep(t, i)}
                      />
                      {s.text}
                    </label>
                  ))}
                  <button
                    className="small ghost"
                    onClick={() =>
                      props.onAsk(`Break "${t.title}" into tiny steps.`)
                    }
                  >
                    <Sparkles size={13} />{" "}
                    {t.steps.length
                      ? "Make the steps smaller"
                      : "Break it down"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CheckInCard({ lastCheckIn, onCheckIn, now }: TodayProps) {
  const [cycle, setCycle] = useState<CheckIn["cycle"] | "">("");
  const recent =
    lastCheckIn && now - new Date(lastCheckIn.at).getTime() < 4 * 3600_000;
  return (
    <section className="card">
      <h3>How's your energy?</h3>
      {recent && (
        <p className="muted">
          Last: {ENERGY[lastCheckIn!.energy - 1].label.toLowerCase()} at{" "}
          {new Date(lastCheckIn!.at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
          . Suggestions adjust to this.
        </p>
      )}
      <div className="energy" role="group" aria-label="Energy level">
        {ENERGY.map((e) => (
          <button
            key={e.value}
            className={
              lastCheckIn?.energy === e.value && recent ? "chip on" : "chip"
            }
            aria-pressed={lastCheckIn?.energy === e.value && recent}
            onClick={() => onCheckIn(e.value, cycle || undefined)}
          >
            <span className={`dot e${e.value}`} aria-hidden />
            {e.label}
          </button>
        ))}
      </div>
      <label className="cycle">
        <span>Cycle (optional, stays on this tablet)</span>
        <select
          value={cycle}
          onChange={(e) => setCycle(e.target.value as CheckIn["cycle"] | "")}
        >
          <option value="">Don't track</option>
          <option value="period">Period</option>
          <option value="follicular">After period</option>
          <option value="ovulation">Mid-cycle</option>
          <option value="luteal">Before period</option>
          <option value="unsure">Not sure</option>
        </select>
      </label>
    </section>
  );
}
