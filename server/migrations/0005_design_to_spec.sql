-- 0005_design_to_spec.sql · rename the product-definition stage from
-- 'design' to 'spec'. The old name was too easy to confuse with technical
-- design, which now belongs at the start of dev.
--
-- SQLite cannot alter a CHECK constraint in place, so this mirrors the
-- table-swap pattern from 0003. PRAGMA defer_foreign_keys keeps task_deps,
-- task_images, and task_links valid while tasks is replaced in this
-- transaction.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE tasks_new (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    type        TEXT NOT NULL CHECK (type IN ('feature','bug')),
    state       TEXT NOT NULL CHECK (state IN ('pending','start','spec','dev','review','done')),
    priority    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

INSERT INTO tasks_new (id, project_id, title, description, type, state, priority, created_at, updated_at)
    SELECT id, project_id, title, description, type,
           CASE WHEN state = 'design' THEN 'spec' ELSE state END,
           priority, created_at, updated_at
      FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX idx_tasks_project_state ON tasks(project_id, state);
CREATE INDEX idx_tasks_priority      ON tasks(project_id, priority DESC);
