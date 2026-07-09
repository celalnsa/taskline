-- 0010_task_claims.sql · multi-agent ownership and lease metadata.
-- Keep this migration text identical in server/migrations/ and
-- server/internal/store/schema/: the former is external migration history,
-- and the latter is embedded into the binary.

ALTER TABLE tasks ADD COLUMN owner TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN claimed_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN lease_expires_at INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_tasks_project_state_owner ON tasks(project_id, state, owner);
CREATE INDEX idx_tasks_owner_lease ON tasks(owner, lease_expires_at);
