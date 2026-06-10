-- 0008_task_labels.sql · task-local GitHub-style labels.

ALTER TABLE tasks ADD COLUMN labels TEXT NOT NULL DEFAULT '[]';
