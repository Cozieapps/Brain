export default `
ALTER TABLE jobs ADD COLUMN scheduled_at TEXT;
UPDATE jobs SET scheduled_at=due_at;
INSERT INTO schema_migrations(version,applied_at) VALUES (2,CURRENT_TIMESTAMP);
`;
