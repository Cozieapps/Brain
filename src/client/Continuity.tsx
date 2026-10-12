import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  Clock,
  Pause,
  Copy,
  ChevronRight,
} from "lucide-react";
import type { RecordItem, ToolName } from "../shared/schema";
import { flowLabels, type Thread } from "../shared/continuity";

type Tool = (name: ToolName, input: any, close?: boolean) => Promise<any>;
export function ConversationStep({
  thread,
  busy,
  tool,
}: {
  thread: Thread;
  busy: boolean;
  tool: Tool;
}) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const q = thread.question!;
  useEffect(() => {
    setValue("");
    input.current?.focus({ preventScroll: true });
    document
      .querySelector(".conversation-step")
      ?.scrollIntoView({ block: "center" });
  }, [thread.id, thread.version]);
  async function answer(text: string) {
    await tool(
      "conversation.answer",
      { id: thread.id, version: thread.version, value: text },
      false,
    );
  }
  return (
    <section
      className="conversation-step"
      aria-label="Continue our conversation"
    >
      <div className="thread-eyebrow">
        <Bookmark size={15} />
        <span>{flowLabels[thread.flow]} · place saved</span>
      </div>
      <h2 id="saved-question">{q.prompt}</h2>
      {q.hint && <p id="question-hint">{q.hint}</p>}
      {q.type === "datetime-local" && (
        <p className="question-zone">Time zone: {thread.data.timezone}</p>
      )}
      {q.choices ? (
        <div className="answer-choices">
          {q.choices.map((c) => (
            <button
              disabled={busy}
              key={c.value}
              onClick={() => void answer(c.value)}
            >
              {c.label}
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void answer(value);
          }}
        >
          {q.type === "number" || q.type === "datetime-local" ? (
            <input
              ref={input}
              aria-labelledby="saved-question"
              aria-describedby={q.hint ? "question-hint" : undefined}
              type={q.type}
              min={q.type === "number" ? 0 : undefined}
              value={value}
              required
              onChange={(e) => setValue(e.target.value)}
            />
          ) : (
            <textarea
              ref={input}
              aria-labelledby="saved-question"
              aria-describedby={q.hint ? "question-hint" : undefined}
              rows={3}
              maxLength={q.maxLength ?? 5000}
              value={value}
              required
              onChange={(e) => setValue(e.target.value)}
              placeholder="Just what you know so far…"
            />
          )}
          <button className="primary" disabled={busy || !value.trim()}>
            Continue <ArrowUpRight size={16} />
          </button>
        </form>
      )}
      <div className="conversation-step-footer">
        {thread.step > 0 && (
          <button
            disabled={busy}
            className="text-button"
            onClick={() =>
              void tool(
                "conversation.back",
                { id: thread.id, version: thread.version },
                false,
              )
            }
          >
            Change my last answer
          </button>
        )}
        {q.optional && (
          <button
            disabled={busy}
            className="text-button"
            onClick={() => void answer("__skip__")}
          >
            Skip for now
          </button>
        )}
        <button
          disabled={busy}
          className="text-button"
          onClick={() =>
            void tool(
              "conversation.pause",
              { id: thread.id, version: thread.version },
              false,
            )
          }
        >
          <Pause size={14} /> Save this spot · talk about something else
        </button>
      </div>
      <small>Guided steps · no AI request for these answers</small>
    </section>
  );
}
export function KeepingTrack({
  data,
  timezone,
  tool,
  open,
  busy,
}: {
  data: any;
  timezone: string;
  tool: Tool;
  open: (r: RecordItem) => void;
  busy: boolean;
}) {
  const [copied, setCopied] = useState("");
  const date = (s: string) =>
    new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    }).format(new Date(s));
  const parked = (data?.threads ?? []).filter(
    (t: Thread) => t.status === "paused",
  );
  const items: {
    record: RecordItem;
    nextCheck: string | null;
    draft: RecordItem | null;
  }[] = data?.items ?? [];
  if (!items.length && !parked.length) return null;
  return (
    <section className="keeping-track" aria-label="Keeping track">
      <div className="thread-eyebrow">
        <Bookmark size={16} />
        <h2>Keeping track for you</h2>
      </div>
      <p className="track-intro">
        Your context stays here between conversations.
      </p>
      {parked.slice(0, 3).map((t: Thread) => (
        <button
          key={t.id}
          className="parked-thread"
          disabled={busy}
          onClick={() => void tool("conversation.resume", { id: t.id }, false)}
        >
          <div>
            <strong>{t.data.title || flowLabels[t.flow]}</strong>
            <span>We left off at: {t.question?.prompt}</span>
          </div>
          <ArrowUpRight size={16} />
        </button>
      ))}
      {items.map(({ record: r, nextCheck, draft }) => (
        <article className="ongoing-thread" key={r.id}>
          <div className="thread-heading">
            <button onClick={() => open(r)}>{r.title}</button>
            <span className="thread-status">
              {r.status === "prepared"
                ? "Ready for your review"
                : r.status === "waiting"
                  ? "Waiting for a response"
                  : r.status === "paused"
                    ? "Set aside"
                    : r.status === "blocked"
                      ? "Needs something first"
                      : r.status}
            </span>
          </div>
          <p>
            {r.status === "waiting"
              ? `Waiting on ${r.data.waitingOn || "an update"}. ${r.data.nextAction}`
              : r.data.nextAction ||
                r.data.outcome ||
                r.data.item ||
                "Your details are saved."}
          </p>
          {nextCheck && (
            <small>
              <Clock size={13} /> Next scheduled check: {date(nextCheck)} ·{" "}
              {timezone}
            </small>
          )}
          {draft && (
            <details className="saved-draft">
              <summary>Prepared draft · unsent</summary>
              <p>{draft.data.body}</p>
              <button onClick={() => open(draft)}>Edit draft</button>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(draft.data.body);
                    setCopied(draft.id);
                  } catch {
                    setCopied("unavailable");
                  }
                }}
              >
                <Copy size={13} />{" "}
                {copied === draft.id ? "Copied" : "Copy draft"}
              </button>
              {copied === "unavailable" && (
                <small>Select the draft text and copy it manually.</small>
              )}
            </details>
          )}
          {r.kind === "task" && (
            <button
              disabled={busy}
              className="text-button"
              onClick={() =>
                void tool(
                  "conversation.begin",
                  { flow: "followup", recordId: r.id },
                  false,
                )
              }
            >
              Pick this up <ArrowUpRight size={15} />
            </button>
          )}
        </article>
      ))}
      {(data?.recent?.length ?? 0) > 0 && (
        <details className="activity-receipts">
          <summary>What has happened</summary>
          {data.recent.map((e: any) => (
            <p key={e.id}>
              <Check size={13} />
              <span>
                {e.title} · {e.action}
                <small>{date(e.created_at)}</small>
              </span>
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
export function PendingSuggestion({
  proposal,
  busy,
  tool,
  records,
}: {
  proposal: any;
  busy: boolean;
  tool: Tool;
  records: RecordItem[];
}) {
  const p = proposal.input;
  const target = records.find((r) => r.id === (p.recordId ?? p.id));
  const begin = proposal.name === "conversation.begin";
  const heading = begin
    ? flowLabels[p.flow as keyof typeof flowLabels]
    : proposal.name === "record.create"
      ? `Save ${p.kind === "memory" ? "a suggested memory" : "this " + p.kind}`
      : "Update this responsibility";
  return (
    <section
      className="result-panel suggestion-card"
      aria-label="Suggested next step"
    >
      <strong>{heading}</strong>
      <p>
        {p.title ||
          target?.title ||
          "Review the suggested change before applying it."}
      </p>
      {p.data && (
        <dl>
          {Object.entries(p.data)
            .filter(([, v]) => v !== "" && v !== null && v !== undefined)
            .map(([key, value]) => (
              <div key={key}>
                <dt>
                  {key
                    .replace(/([A-Z])/g, " $1")
                    .replace(/^./, (s) => s.toUpperCase())}
                </dt>
                <dd>
                  {Array.isArray(value)
                    ? value.join(", ") || "None"
                    : String(value)}
                </dd>
              </div>
            ))}
        </dl>
      )}
      {p.status && <p>Status: {p.status}</p>}
      {p.evidence && <p>Evidence: {p.evidence}</p>}
      <small>AI suggestion · your choice · no external action</small>
      <div className="suggestion-actions">
        <button
          className="small-button"
          disabled={busy}
          onClick={() =>
            void tool("proposal.apply", { id: proposal.id }, false)
          }
        >
          {begin ? "Let's do this" : "Apply this change"}
        </button>
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            void tool("proposal.dismiss", { id: proposal.id }, false)
          }
        >
          Set aside
        </button>
      </div>
    </section>
  );
}
