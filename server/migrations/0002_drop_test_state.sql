-- 0002_drop_test_state.sql · 'test' was removed from the workflow.
-- Remap any existing rows so they remain reachable. We pick 'dev' (the
-- stage that fed test) rather than 'review' so the work stays visible
-- and runnable rather than getting auto-shipped past inspection.
UPDATE tasks SET state = 'dev' WHERE state = 'test';
