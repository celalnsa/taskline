-- 0007_task_docs.sql · Markdown documents attached to tasks.
-- The DB keeps metadata plus a local file reference; markdown content lives
-- on disk under TASKLINE_DOCS_DIR.

CREATE TABLE task_docs (
    id           TEXT PRIMARY KEY,
    task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE INDEX idx_task_docs_task ON task_docs(task_id);
