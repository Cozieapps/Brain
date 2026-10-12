import { Store } from "./store";
import type { RecordItem } from "../shared/schema";
import { dateInZone, nextQuietEnd, quietAt } from "../shared/time";
export const terminal = new Set(["completed", "confirmed", "dropped"]);
export function schedule(
  store: Store,
  recordId: string,
  at: string,
  essential = false,
  source = "manual",
) {
  store.get(recordId);
  const due = new Date(at).toISOString();
  const key = `${store.profileId}:${recordId}:${source}:${due}`;
  store.db.run(
    "INSERT INTO jobs(id,profile_id,record_id,due_at,status,dedupe_key,essential,created_at,scheduled_at) VALUES (?,?,?,?,'pending',?,?,?,?) ON CONFLICT(dedupe_key) DO UPDATE SET status=CASE WHEN jobs.status='cancelled' THEN 'pending' ELSE jobs.status END",
    crypto.randomUUID(),
    store.profileId,
    recordId,
    due,
    key,
    essential ? 1 : 0,
    store.now(),
    due,
  );
}
export function reconcileRecord(store: Store, r: RecordItem) {
  store.db.run(
    "UPDATE jobs SET status='cancelled',lease_until=NULL WHERE record_id=? AND profile_id=? AND status IN ('pending','running')",
    r.id,
    store.profileId,
  );
  if (
    terminal.has(r.status) ||
    ["paused", "failed", "blocked"].includes(r.status)
  )
    return;
  if (r.kind === "task") {
    if (r.data.deadline)
      schedule(
        store,
        r.id,
        r.data.deadline,
        r.data.essential && r.data.dateKind === "real",
        "deadline",
      );
    if (r.status === "waiting")
      schedule(
        store,
        r.id,
        new Date(new Date(r.updatedAt).getTime() + 3 * 86400000).toISOString(),
        false,
        "waiting",
      );
  }
  if (r.kind === "person" && r.data.followUpAt)
    schedule(store, r.id, r.data.followUpAt, false, "followup");
  if (r.kind === "pause")
    schedule(store, r.id, r.data.reviewAt, false, "review");
  if (r.kind === "transition")
    schedule(store, r.id, r.data.startAt, true, "transition");
  if (r.kind === "appointment")
    schedule(
      store,
      r.id,
      new Date(new Date(r.data.startsAt).getTime() - 30 * 60000).toISOString(),
      true,
      "appointment",
    );
}
export function tick(store: Store) {
  const now = store.now();
  store.db.transaction(() => {
    store.db.run(
      "UPDATE jobs SET status='pending',lease_until=NULL WHERE status='running' AND lease_until<?",
      now,
    );
    const jobs = store.db.all(
      "SELECT * FROM jobs WHERE status='pending' AND due_at<=? ORDER BY essential DESC,due_at LIMIT 40",
      now,
    );
    for (const job of jobs) {
      const scoped = new Store(store.db, job.profile_id, store.clock);
      const settings = scoped.settings();
      let record: RecordItem;
      try {
        record = scoped.get(job.record_id);
      } catch {
        store.db.run("UPDATE jobs SET status='cancelled' WHERE id=?", job.id);
        continue;
      }
      if (terminal.has(record.status) || record.status === "paused") {
        store.db.run("UPDATE jobs SET status='cancelled' WHERE id=?", job.id);
        continue;
      }
      const monitored =
        settings.monitoring.includes(record.kind as any) ||
        job.dedupe_key.includes(":manual:");
      if (!settings.remindersEnabled || !monitored) {
        defer(new Date(store.clock().getTime() + 3600000).toISOString());
        continue;
      }
      if (
        settings.pausedUntil &&
        Date.parse(settings.pausedUntil) > store.clock().getTime()
      ) {
        defer(settings.pausedUntil);
        continue;
      }
      if (
        settings.quietEnabled &&
        quietAt(
          now,
          settings.timezone,
          settings.quietStart,
          settings.quietEnd,
        ) &&
        !(job.essential && settings.urgencyExceptions)
      ) {
        defer(nextQuietEnd(now, settings.timezone, settings.quietEnd));
        continue;
      }
      const today = dateInZone(now, settings.timezone);
      const sent = store.db
        .all(
          "SELECT created_at FROM notifications WHERE profile_id=? AND created_at>=?",
          job.profile_id,
          new Date(store.clock().getTime() - 48 * 3600000).toISOString(),
        )
        .filter(
          (n) => dateInZone(n.created_at, settings.timezone) === today,
        ).length;
      const budget =
        settings.capacity === "low"
          ? Math.min(1, settings.notificationBudget)
          : settings.notificationBudget;
      if (sent >= budget) {
        defer(new Date(store.clock().getTime() + 3600000).toISOString());
        continue;
      }
      // One unseen reminder per responsibility. Ignoring it never creates a nagging loop.
      if (
        store.db.all(
          "SELECT id FROM notifications WHERE profile_id=? AND record_id=? AND read_at IS NULL",
          job.profile_id,
          job.record_id,
        ).length
      ) {
        store.db.run("UPDATE jobs SET status='suppressed' WHERE id=?", job.id);
        continue;
      }
      if (job.attempts >= 3) {
        store.db.run(
          "UPDATE jobs SET status='failed',last_error='Retry limit reached' WHERE id=?",
          job.id,
        );
        continue;
      }
      store.db.run(
        "UPDATE jobs SET status='running',attempts=attempts+1,lease_until=? WHERE id=?",
        new Date(store.clock().getTime() + 60000).toISOString(),
        job.id,
      );
      const attempt = crypto.randomUUID();
      store.db.run(
        "INSERT INTO job_attempts(id,job_id,started_at,outcome) VALUES (?,?,?,?)",
        attempt,
        job.id,
        now,
        "running",
      );
      try {
        const overdue =
          new Date(job.due_at).getTime() < store.clock().getTime() - 3600000;
        const body =
          record.kind === "transition"
            ? "Your saved transition plan is ready. Your place is held; leaving and arriving still need your confirmation."
            : record.kind === "pause"
              ? "Your saved pause is ready for review. You can proceed, change it, or let it go."
              : record.data.nextAction ||
                record.data.followUp ||
                "Ready for a look when you have room.";
        store.db.run(
          "INSERT OR IGNORE INTO notifications(id,profile_id,record_id,job_id,title,body,created_at) VALUES (?,?,?,?,?,?,?)",
          crypto.randomUUID(),
          job.profile_id,
          job.record_id,
          job.id,
          record.title,
          (overdue ? "While you were away: " : "") + body,
          now,
        );
        store.db.run(
          "UPDATE jobs SET status='completed',lease_until=NULL WHERE id=?",
          job.id,
        );
        store.db.run(
          "UPDATE job_attempts SET outcome='completed' WHERE id=?",
          attempt,
        );
      } catch {
        store.db.run(
          "UPDATE jobs SET status=?,lease_until=NULL,last_error='Notification could not be saved',due_at=? WHERE id=?",
          job.attempts + 1 >= 3 ? "failed" : "pending",
          new Date(
            store.clock().getTime() + Math.pow(2, job.attempts) * 60000,
          ).toISOString(),
          job.id,
        );
        store.db.run(
          "UPDATE job_attempts SET outcome='failed' WHERE id=?",
          attempt,
        );
      }
      function defer(at: string) {
        store.db.run(
          "UPDATE jobs SET due_at=? WHERE id=?",
          new Date(at).toISOString(),
          job.id,
        );
      }
    }
    store.db.run(
      "INSERT INTO runtime(key,value) VALUES ('worker_checked',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      now,
    );
  });
}
