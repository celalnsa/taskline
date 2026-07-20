-- 0013_task_events.sql · append-only task operation history.
--
-- Keep this migration text identical in server/migrations/ and
-- server/internal/store/schema/: the former is external migration history,
-- the latter is embedded into the single taskline-server binary.

CREATE TABLE task_events (
    id         TEXT PRIMARY KEY,
    task_id    TEXT NOT NULL,
    actor      TEXT NOT NULL,
    action     TEXT NOT NULL,
    summary    TEXT NOT NULL,
    details    TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_task_events_task_created
    ON task_events(task_id, created_at DESC);

-- Historical mutations cannot be reconstructed from snapshots. Preserve an
-- honest creation boundary so existing tasks do not start with empty history.
INSERT INTO task_events(id, task_id, actor, action, summary, details, created_at)
SELECT 'backfill-' || id, id, 'system', 'created',
       'Created task (history backfill)', '{}', created_at
  FROM tasks;
