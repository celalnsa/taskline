# Dependency Graph Edit Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a task card in the Dependency graph opens the shared task edit dialog and lets users edit that task.

**Architecture:** Reuse the existing `TaskEditor` component already used by the Kanban board. `GraphView` will keep an `editing` task state alongside the existing selected-highlight state, pass the active task and full task list into `TaskEditor`, and close the dialog by clearing `editing`.

**Tech Stack:** React, TypeScript, React Query hooks, `@xyflow/react`, Vitest, Testing Library, headless Chrome smoke via CDP.

---

## Scope

- Keep the existing graph relationship highlighting behavior.
- Do not add a separate graph-specific editor.
- Do not change dependency layout, edge creation, or state select behavior.
- Reuse `TaskEditor` edit mode so title, description, type, state, priority, labels, docs, links, images, and dependencies remain consistent with Kanban editing.

## Files

- Modify `web/src/components/GraphView.tsx`
  - Import `TaskEditor`.
  - Track `editing: Task | null`.
  - Open the editor when a graph node is clicked.
  - Render `TaskEditor` with `project`, `task`, `allTasks`, and `onClose`.
- Modify `web/src/components/GraphView.test.tsx`
  - Mock `TaskEditor` for graph-level integration tests.
  - Add a failing test that clicking a graph node opens the edit dialog for that task.
  - Add a close-path assertion to prove `onClose` clears the dialog.
- No server, CLI, or schema changes are expected.

## Test Plan

- RED:
  - Add `GraphView` test for node click opening edit dialog.
  - Run `cd web && mise exec -- pnpm test -- --run src/components/GraphView.test.tsx`.
  - Expected failure: edit dialog not found after node click.
- GREEN:
  - Implement minimal `TaskEditor` wiring in `GraphView`.
  - Rerun the focused GraphView test and expect pass.
- Full local:
  - `cd web && mise exec -- pnpm lint && mise exec -- pnpm test -- --run && mise exec -- pnpm build`.
  - `cd server && mise exec -- go test ./...`.
  - `cd cli && mise exec -- go test ./...`.
  - `git diff --check`.
- Browser smoke:
  - Rebuild/start local server on `*:8787`.
  - Create a project and a graph task through the API.
  - Open the Dependency graph tab.
  - Click the graph task node.
  - Confirm the edit dialog opens.
  - Edit the title and save.
  - Confirm the API returns the updated title.

## Acceptance Criteria

- Clicking a task card/node in Dependency graph opens the existing edit task modal.
- Editing and saving from the graph modal updates the task through the existing API path.
- Existing graph selection highlighting remains intact.
- Pane click still clears graph highlighting.
- All full local checks and browser smoke pass.
