-- 0012_task_completion.sql · stable task completion timestamp.
--
-- Keep this migration text identical in server/migrations/ and
-- server/internal/store/schema/: the former is external migration history,
-- the latter is embedded into the single taskline-server binary.

ALTER TABLE tasks ADD COLUMN completed_at INTEGER NOT NULL DEFAULT 0;

-- Historical done tasks have no transition log. Their last update is the best
-- one-time backfill available; later edits will no longer move this value.
UPDATE tasks SET completed_at = updated_at WHERE state = 'done';
