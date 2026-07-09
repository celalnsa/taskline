-- 0011_task_agents.sql · local agent identity tokens.
--
-- Keep this migration text identical in server/migrations/ and
-- server/internal/store/schema/: the former is external migration history,
-- the latter is embedded into the single taskline-server binary.

CREATE TABLE task_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_task_agents_token_hash ON task_agents(token_hash);
