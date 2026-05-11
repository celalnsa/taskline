-- 0003_pending_state.sql · introduce 'pending' as a non-runnable parking
-- lot and rename the entry state 'created' → 'start'. SQLite has no
-- ALTER TABLE for changing a CHECK constraint, so the supported recipe
-- is CREATE NEW / COPY / DROP OLD / RENAME. We rely on
-- PRAGMA defer_foreign_keys = ON to keep task_deps FKs valid across the
-- table swap within this transaction; the migration runner provides
-- the surrounding BEGIN/COMMIT.

UPDATE tasks SET state = 'start' WHERE state = 'created';

PRAGMA defer_foreign_keys = ON;

CREATE TABLE tasks_new (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    type        TEXT NOT NULL CHECK (type IN ('feature','bug')),
    state       TEXT NOT NULL CHECK (state IN ('pending','start','design','dev','review','done')),
    priority    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

INSERT INTO tasks_new (id, project_id, title, description, type, state, priority, created_at, updated_at)
    SELECT id, project_id, title, description, type, state, priority, created_at, updated_at FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX idx_tasks_project_state ON tasks(project_id, state);
CREATE INDEX idx_tasks_priority      ON tasks(project_id, priority DESC);
