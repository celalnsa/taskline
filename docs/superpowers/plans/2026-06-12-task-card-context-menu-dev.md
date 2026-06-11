# Task Card Context Menu Dev Notes

Task: `e50c12aa-6a9f-426b-ab2a-19e4d44ff021`

## Implementation

- Added `TaskContextMenu`, a shared fixed-position menu with `Copy` and
  `Delete` actions.
- Added shared task action helpers:
  - `confirmTaskDelete` keeps the existing delete confirmation text.
  - `createTaskCopyDraft` copies title, description, type, state, priority, and
    labels while leaving links, docs, images, and dependencies empty.
- Removed the hover delete icon from `TaskCard`.
- Added TaskCard right-click handling without changing left-click edit or drag
  behavior.
- Added Kanban menu state, delete handling, and create-mode copy editor in
  `KanbanBoard`.
- Added Dependency graph node context-menu handling, delete handling, and
  create-mode copy editor in `GraphView`.

## Tests Added Or Updated

- Updated `TaskCard.test.tsx` to assert right-click invokes context-menu handling
  and the old delete icon is absent.
- Added `KanbanBoard.test.tsx` for right-click delete and copy actions.
- Extended `GraphView.test.tsx` for right-click delete and copy actions.

## TDD Evidence

- Red run:
  `mise exec -- pnpm --dir web test src/components/TaskCard.test.tsx src/components/KanbanBoard.test.tsx src/components/GraphView.test.tsx`
  failed because the context menu did not exist, TaskCard did not forward
  right-clicks, and the old delete icon was still rendered.
- Green run:
  `mise exec -- pnpm --dir web test src/components/TaskCard.test.tsx src/components/KanbanBoard.test.tsx src/components/GraphView.test.tsx`
  passed with `23` tests.

## Divergence

No server, API, persistence, or CLI changes were needed. Copy is intentionally a
client-side create draft until the user clicks `Create`.
