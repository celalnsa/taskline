# Task Card Context Menu

Task: `e50c12aa-6a9f-426b-ab2a-19e4d44ff021`

## Goal

Move task-card secondary actions into a right-click menu that works in both
Kanban and Dependency graph views.

## Product Requirements

- Right-clicking a task card in Kanban opens a compact task action menu.
- Right-clicking a task node in the Dependency graph opens the same task action
  menu.
- The menu contains exactly two actions: `Copy` and `Delete`.
- `Delete` uses the existing confirm wording and then deletes the task.
- Remove the hover-only delete icon from Kanban task cards.
- `Copy` opens the shared create-task editor prefilled with the source task's
  basic information.
- Copying must not create a task until the user clicks `Create` in the editor.
- Copy basic information includes title, description, type, state, priority, and
  labels. It does not copy attachments, links, docs, images, or dependencies.
- The menu closes on action, outside click, Escape, or pane/background click.

## Technical Design

- Add a shared `TaskContextMenu` component for the fixed-position menu.
- Add shared helpers for delete confirmation and creating a copy draft.
- Keep card click behavior unchanged: left-click still opens edit, drag still
  drags, right-click opens the menu.
- In Kanban, own the menu state and copy-draft create editor from
  `KanbanBoard.tsx`.
- In Dependency graph, use React Flow's node context-menu event and own the same
  menu/copy/delete state from `GraphView.tsx`.
- Keep deletion mutations in each parent view so existing query invalidation and
  error handling stay local.

## Test Plan

- Update TaskCard tests to prove the hover delete icon is gone and right-click
  invokes the context-menu callback without opening the editor.
- Add KanbanBoard tests for right-click menu delete and copy actions.
- Extend GraphView tests for right-click menu delete and copy actions.
- Run focused tests first and confirm they fail before implementation.
- After implementation, run focused component tests, frontend lint/test/build,
  and browser smoke against the rebuilt embedded web bundle.
