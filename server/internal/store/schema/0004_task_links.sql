-- 0004_task_links.sql · per-task URL attachments (plan docs, PRs, etc).
-- Mirrors the task_images shape: one row per (task, url), cascaded on
-- task delete.

CREATE TABLE task_links (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    label       TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
);

CREATE INDEX idx_task_links_task ON task_links(task_id);
