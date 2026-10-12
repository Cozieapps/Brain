export default `
CREATE TABLE IF NOT EXISTS companion_threads (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, flow TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, status TEXT NOT NULL,
  record_id TEXT, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_current_thread
ON companion_threads(profile_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS companion_proposals (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, proposal TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, CURRENT_TIMESTAMP);
`;
