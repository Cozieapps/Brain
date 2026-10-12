import migration from "../../migrations/001_initial";
import reminderMigration from "../../migrations/002_reminder_intent";
import continuityMigration from "../../migrations/003_continuity";
import {
  settingsSchema,
  type Kind,
  type Message,
  type RecordItem,
  type Settings,
  type Status,
} from "../shared/schema";
export interface Database {
  all(sql: string, ...params: any[]): any[];
  run(sql: string, ...params: any[]): void;
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
}
export class Store {
  constructor(
    public db: Database,
    public profileId = "personal",
    public clock: () => Date = () => new Date(),
  ) {
    db.exec(migration);
    db.transaction(() => {
      if (
        !db.all("SELECT version FROM schema_migrations WHERE version=2").length
      )
        db.exec(reminderMigration);
      if (
        !db.all("SELECT version FROM schema_migrations WHERE version=3").length
      )
        db.exec(continuityMigration);
    });
    this.ensureProfile();
  }
  now() {
    return this.clock().toISOString();
  }
  ensureProfile() {
    this.db.run(
      "INSERT OR IGNORE INTO profiles(id,settings) VALUES (?,?)",
      this.profileId,
      JSON.stringify(settingsSchema.parse({})),
    );
  }
  settings(): Settings {
    return settingsSchema.parse(
      JSON.parse(
        this.db.all(
          "SELECT settings FROM profiles WHERE id=?",
          this.profileId,
        )[0].settings,
      ),
    );
  }
  saveSettings(settings: Settings) {
    this.db.run(
      "UPDATE profiles SET settings=? WHERE id=?",
      JSON.stringify(settingsSchema.parse(settings)),
      this.profileId,
    );
  }
  row(r: any): RecordItem {
    return {
      id: r.id,
      profileId: r.profile_id,
      kind: r.kind,
      title: r.title,
      status: r.status,
      data: JSON.parse(r.data),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      version: r.version,
    };
  }
  get(id: string) {
    const r = this.db.all(
      "SELECT * FROM records WHERE id=? AND profile_id=?",
      id,
      this.profileId,
    )[0];
    if (!r) throw new Error("This item is no longer available.");
    return this.row(r);
  }
  list(kind?: Kind): RecordItem[] {
    return this.db
      .all(
        `SELECT * FROM records WHERE profile_id=? ${kind ? "AND kind=?" : ""} ORDER BY updated_at DESC LIMIT 1000`,
        this.profileId,
        ...(kind ? [kind] : []),
      )
      .map((r) => this.row(r));
  }
  index(r: RecordItem) {
    this.db.run(
      "DELETE FROM record_search WHERE record_id=? AND profile_id=?",
      r.id,
      this.profileId,
    );
    this.db.run(
      "INSERT INTO record_search(record_id,profile_id,title,body) VALUES (?,?,?,?)",
      r.id,
      this.profileId,
      r.title,
      JSON.stringify(r.data),
    );
  }
  create(
    kind: Kind,
    title: string,
    data: Record<string, any>,
    status: Status = "active",
  ) {
    return this.db.transaction(() => {
      const r: RecordItem = {
        id: crypto.randomUUID(),
        profileId: this.profileId,
        kind,
        title,
        status,
        data,
        createdAt: this.now(),
        updatedAt: this.now(),
        version: 1,
      };
      this.db.run(
        "INSERT INTO records(id,profile_id,kind,title,status,data,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?)",
        r.id,
        r.profileId,
        r.kind,
        r.title,
        r.status,
        JSON.stringify(r.data),
        r.createdAt,
        r.updatedAt,
        1,
      );
      this.index(r);
      this.event(r.id, "created");
      return r;
    });
  }
  event(id: string, action: string, previous?: RecordItem) {
    this.db.run(
      "INSERT INTO events(id,profile_id,record_id,action,previous,created_at) VALUES (?,?,?,?,?,?)",
      crypto.randomUUID(),
      this.profileId,
      id,
      action,
      previous ? JSON.stringify(previous) : null,
      this.now(),
    );
  }
  update(
    id: string,
    version: number,
    changes: Partial<Pick<RecordItem, "title" | "status" | "data">>,
    action = "updated",
  ) {
    return this.db.transaction(() => {
      const old = this.get(id);
      if (old.version !== version)
        throw new Error(
          "This item changed in another window. Refresh and try again.",
        );
      const next = {
        ...old,
        ...changes,
        version: old.version + 1,
        updatedAt: this.now(),
      };
      this.event(id, action, old);
      this.db.run(
        "UPDATE records SET title=?,status=?,data=?,updated_at=?,version=? WHERE id=? AND profile_id=?",
        next.title,
        next.status,
        JSON.stringify(next.data),
        next.updatedAt,
        next.version,
        id,
        this.profileId,
      );
      this.index(next);
      if (["completed", "confirmed", "dropped"].includes(next.status))
        this.db.run(
          "UPDATE companion_threads SET status='finished',version=version+1,updated_at=? WHERE profile_id=? AND record_id=? AND status!='finished'",
          this.now(),
          this.profileId,
          next.id,
        );
      return next;
    });
  }
  contentRevision() {
    return (
      this.db.all(
        "SELECT value FROM runtime WHERE key=?",
        "content-revision:" + this.profileId,
      )[0]?.value ?? "0"
    );
  }
  invalidateContext() {
    this.db.run(
      "INSERT INTO runtime(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      "content-revision:" + this.profileId,
      crypto.randomUUID(),
    );
  }
  forget(id: string) {
    this.get(id);
    this.db.transaction(() => {
      for (const table of ["record_search", "events", "notifications"])
        this.db.run(
          `DELETE FROM ${table} WHERE record_id=? AND profile_id=?`,
          id,
          this.profileId,
        );
      this.db.run(
        "DELETE FROM job_attempts WHERE job_id IN (SELECT id FROM jobs WHERE record_id=? AND profile_id=?)",
        id,
        this.profileId,
      );
      this.db.run(
        "DELETE FROM jobs WHERE record_id=? AND profile_id=?",
        id,
        this.profileId,
      );
      this.db.run(
        "DELETE FROM records WHERE id=? AND profile_id=?",
        id,
        this.profileId,
      );
      // Previously generated conversation context could retain a forgotten fact. Clear it too.
      this.db.run("DELETE FROM messages WHERE profile_id=?", this.profileId);
      // Draft conversations and pending proposals can contain copies of the forgotten context.
      this.db.run(
        "DELETE FROM companion_threads WHERE profile_id=?",
        this.profileId,
      );
      this.db.run(
        "DELETE FROM companion_proposals WHERE profile_id=?",
        this.profileId,
      );
      this.invalidateContext();
    });
  }
  undo(id: string) {
    return this.db.transaction(() => {
      const r = this.get(id);
      const e = this.db.all(
        "SELECT * FROM events WHERE profile_id=? AND record_id=? AND previous IS NOT NULL AND undone=0 AND action != ? ORDER BY created_at DESC,rowid DESC LIMIT 1",
        this.profileId,
        id,
        "undo",
      )[0];
      if (!e) throw new Error("There is no reversible change for this item.");
      const prev = JSON.parse(e.previous);
      const restored = this.update(
        id,
        r.version,
        { title: prev.title, status: prev.status, data: prev.data },
        "undo",
      );
      this.db.run("UPDATE events SET undone=1 WHERE id=?", e.id);
      return restored;
    });
  }
  search(query: string, kind?: Kind) {
    const tokens =
      query
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu)
        ?.slice(0, 8) ?? [];
    if (!tokens.length) return this.list(kind).slice(0, 8);
    const match = tokens.map((t) => '"' + t + '"*').join(" OR ");
    const rows = this.db.all(
      "SELECT record_id FROM record_search WHERE record_search MATCH ? AND profile_id=? ORDER BY rank LIMIT 30",
      match,
      this.profileId,
    );
    let found = rows
      .map((r) => this.get(r.record_id))
      .filter((r) => !kind || r.kind === kind);
    if (!found.length) {
      const q = tokens.join(" ");
      found = this.list(kind).filter(
        (r) =>
          similar(q, r.title.toLowerCase()) > 0.45 ||
          JSON.stringify(r.data).toLowerCase().includes(q),
      );
    }
    return found
      .filter(
        (r) =>
          r.kind !== "memory" ||
          !r.data.expiresAt ||
          Date.parse(r.data.expiresAt) > this.clock().getTime(),
      )
      .slice(0, 8);
  }
  message(
    role: Message["role"],
    content: string,
    source: Message["source"] = "guided",
    action?: string,
  ) {
    const m = {
      id: crypto.randomUUID(),
      role,
      content,
      source,
      createdAt: this.now(),
      action,
    };
    this.db.run(
      "INSERT INTO messages(id,profile_id,role,content,source,action,created_at) VALUES (?,?,?,?,?,?,?)",
      m.id,
      this.profileId,
      role,
      content,
      source,
      action ?? null,
      m.createdAt,
    );
    return m;
  }
  messages(): Message[] {
    return this.db
      .all(
        "SELECT * FROM (SELECT rowid AS seq,* FROM messages WHERE profile_id=? ORDER BY created_at DESC,rowid DESC LIMIT 80) ORDER BY created_at,seq",
        this.profileId,
      )
      .map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        source: r.source,
        action: r.action,
        createdAt: r.created_at,
      }));
  }
  export() {
    return {
      format: "beside-v1",
      exportedAt: this.now(),
      settings: this.settings(),
      conversations: this.db.all(
        "SELECT * FROM companion_threads WHERE profile_id=?",
        this.profileId,
      ),
      proposals: this.db.all(
        "SELECT * FROM companion_proposals WHERE profile_id=?",
        this.profileId,
      ),
      records: this.db
        .all(
          "SELECT * FROM records WHERE profile_id=? ORDER BY created_at",
          this.profileId,
        )
        .map((r) => this.row(r)),
      messages: this.db.all(
        "SELECT id,role,content,source,action,created_at FROM messages WHERE profile_id=? ORDER BY created_at,rowid",
        this.profileId,
      ),
      jobAttempts: this.db.all(
        "SELECT * FROM job_attempts WHERE job_id IN (SELECT id FROM jobs WHERE profile_id=?)",
        this.profileId,
      ),
      events: this.db.all(
        "SELECT * FROM events WHERE profile_id=?",
        this.profileId,
      ),
      reminders: this.db.all(
        "SELECT * FROM jobs WHERE profile_id=?",
        this.profileId,
      ),
      notifications: this.db.all(
        "SELECT * FROM notifications WHERE profile_id=?",
        this.profileId,
      ),
      attachments: this.db.all(
        "SELECT id,name,mime,content,created_at FROM attachments WHERE profile_id=?",
        this.profileId,
      ),
    };
  }
  deleteAll() {
    this.db.transaction(() => {
      this.invalidateContext();
      this.db.run(
        "DELETE FROM job_attempts WHERE job_id IN (SELECT id FROM jobs WHERE profile_id=?)",
        this.profileId,
      );
      for (const table of [
        "record_search",
        "records",
        "events",
        "messages",
        "jobs",
        "notifications",
        "attachments",
        "usage",
        "companion_threads",
        "companion_proposals",
      ])
        this.db.run(`DELETE FROM ${table} WHERE profile_id=?`, this.profileId);
      this.saveSettings(settingsSchema.parse({}));
    });
  }
}
function similar(a: string, b: string) {
  const pairs = (s: string) =>
    new Set(
      Array.from({ length: Math.max(0, s.length - 1) }, (_, i) =>
        s.slice(i, i + 2),
      ),
    );
  const x = pairs(a),
    y = pairs(b);
  return (2 * [...x].filter((v) => y.has(v)).length) / (x.size + y.size || 1);
}
