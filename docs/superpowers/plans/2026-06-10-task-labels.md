# Task Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub-style text labels to taskline tasks across the API, CLI, web editor, and agent skill contract.

**Architecture:** Store labels as an ordered JSON string array on each task row. The server owns normalization and validation, task responses include labels inline with the existing task shape, the CLI exposes repeatable `--label` flags, and the web editor renders labels as small chips with add/remove controls.

**Tech Stack:** Go + Hertz + SQLite (`modernc.org/sqlite`), Cobra CLI, React + Vite + TanStack Query, taskline-management skill docs.

---

## Product Design

Users can attach zero or more text labels to a task, similar to GitHub labels. Labels are task-local strings, not global project resources: there is no color registry, no label management page, and no filtering in this first pass. This keeps the feature aligned with the task request while leaving room for later enhancements.

Labels appear inline in task JSON, in the CLI JSON output, on web task cards, and inside the task editor. The editor provides a compact chip input: type a label, press Enter or comma to add it, and remove labels with an `X` icon button. Labels can be set during task creation and edited later.

Labels are normalized by the server:

- Trim surrounding whitespace.
- Reject blank labels.
- Preserve the first occurrence order.
- Deduplicate case-insensitively.
- Limit each label to 64 Unicode code points and at most 20 labels per task.

## Technical Design

### Data Model

Add `labels TEXT NOT NULL DEFAULT '[]'` to `tasks`. A JSON array is enough because labels are task-local, ordered, and not independently queried in this task. This avoids over-building a project-level registry and keeps reads simple.

`server/api/model.Task` gains:

```go
Labels []string `json:"labels,omitempty"`
```

The store scans `labels`, unmarshals it into `[]string`, and marshals normalized values on create/update.

### API IDL

Task response:

```json
{
  "id": "uuid",
  "title": "Add task labels",
  "labels": ["backend", "ui"]
}
```

Create task request:

```json
{
  "title": "Add task labels",
  "type": "feature",
  "priority": 1,
  "labels": ["backend", "ui"]
}
```

Patch task request:

```json
{
  "labels": ["review", "frontend"]
}
```

`labels` is optional in both create and patch. Omitted means unchanged on patch. An explicit empty array clears labels.

Validation errors return the existing JSON error shape and HTTP status mapping.

### CLI Contract

Create:

```bash
taskline task create --project taskline --title "Label me" --label backend --label ui
```

Update:

```bash
taskline task update <id> --label review --label frontend
taskline task update <id> --clear-labels
```

`--label` is repeatable and replaces the full label set on update. `--clear-labels` sets labels to an empty list. Passing both on update is an error.

### Web Contract

`web/src/lib/api.ts` mirrors the `labels?: string[]` field and includes it in create/update inputs.

`TaskEditor` owns a `labels` state array and a small `LabelSection`. The section works in both create and edit mode. Create mode submits labels in the initial create request; edit mode submits labels with the task patch.

`TaskCard` renders up to three label chips and a `+N` overflow chip. This makes labels visible in the Kanban view without expanding card height unpredictably.

### Skill Contract

`skills/taskline-management/SKILL.md` documents `labels`, `--label`, and `--clear-labels` so agents can create and update labels without modifying descriptions.

## Implementation Plan

### Task 1: Server Persistence and API

**Files:**
- Modify: `server/api/model/model.go`
- Modify: `server/internal/store/store.go`
- Modify: `server/internal/service/service.go`
- Modify: `server/api/handler/handler.go`
- Create: `server/internal/store/schema/0008_task_labels.sql`
- Create: `server/migrations/0008_task_labels.sql`
- Test: `server/internal/store/store_test.go`
- Test: `server/tests/e2e_test.go`

- [ ] Write failing store tests for create/update/list/get labels, including dedupe and clear.
- [ ] Run `cd server && mise exec -- go test ./internal/store -run TestTaskLabels`.
- [ ] Add migration v8 and task label encode/decode helpers.
- [ ] Update model, store create/update/list/get scan paths.
- [ ] Run focused store tests and confirm they pass.
- [ ] Write failing API e2e tests for create labels, patch labels, invalid blank label, and clear labels.
- [ ] Run `cd server && mise exec -- go test ./tests -run TestTaskLabelsAtAPI`.
- [ ] Update handler request structs and service validation.
- [ ] Run focused API tests and confirm they pass.

### Task 2: CLI Surface

**Files:**
- Modify: `cli/client/client.go`
- Modify: `cli/client/client_test.go`
- Modify: `cli/cmd/task.go`
- Modify: `cli/cmd/task_test.go`

- [ ] Write failing client tests showing create/update payloads include `labels`.
- [ ] Write failing command registration tests for repeatable `--label` and `--clear-labels`.
- [ ] Run `cd cli && mise exec -- go test ./client ./cmd -run 'TestTaskLabel|TestCreateTask|TestUpdateTask'`.
- [ ] Add client labels fields and CLI flags.
- [ ] Render labels in the task table after priority.
- [ ] Run focused CLI tests and confirm they pass.

### Task 3: Web UI and API Helpers

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/lib/api.test.ts`
- Modify: `web/src/components/TaskEditor.tsx`
- Modify: `web/src/components/TaskEditor.test.tsx`
- Modify: `web/src/components/TaskCard.tsx`
- Modify: `web/src/components/TaskCard.test.tsx`

- [ ] Write failing API helper tests proving create/update sends labels.
- [ ] Write failing editor tests for adding/removing labels in create and edit mode.
- [ ] Write failing card test for visible label chips.
- [ ] Run `cd web && mise exec -- pnpm test -- --run src/lib/api.test.ts src/components/TaskEditor.test.tsx src/components/TaskCard.test.tsx`.
- [ ] Add labels to TypeScript task shape and API helper inputs.
- [ ] Implement label chip input in `TaskEditor`.
- [ ] Render compact label chips in `TaskCard`.
- [ ] Run focused web tests and confirm they pass.

### Task 4: Docs, Skill, and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `skills/taskline-management/SKILL.md`
- Optionally modify: `ARCHITECTURE.md`

- [ ] Update docs only where labels affect current usage or contracts.
- [ ] Run `./scripts/test-skill.sh`.
- [ ] Run `cd server && mise exec -- go test ./...`.
- [ ] Run `cd cli && mise exec -- go test ./...`.
- [ ] Run `cd web && mise exec -- pnpm lint && mise exec -- pnpm test -- --run && mise exec -- pnpm build`.
- [ ] Run `./scripts/build.sh`.
- [ ] Restart the local `taskline` service if the merged behavior needs to be available on `:8610`.
- [ ] Run CLI/API smoke against a rebuilt server: create a task with labels, update labels, clear labels, and verify task JSON.
- [ ] Run browser smoke against the embedded UI: create or edit a task with labels, verify chips show in the editor/card, and verify API state.
- [ ] Restore `server/web/dist/.gitkeep` if Vite removes it.
- [ ] Create/update task docs: `Dev Notes`, `Test Report`, and `Review Report`.
- [ ] Commit, push, create PR, wait for CI and review, address comments, merge, and confirm `task next --project taskline --format json` returns the next runnable task or `null`.

## Test Plan

- Store unit tests cover persistence, JSON decoding, normalization, dedupe, clearing, and update semantics.
- Server e2e tests cover API request/response shape and validation errors.
- CLI tests cover request payloads and flag contract.
- Web unit tests cover API helpers, editor interactions, and card rendering.
- Runtime smoke covers the rebuilt binary and real browser behavior.

## Architecture Review

I considered three options:

1. **Task-local JSON array on `tasks`**: simplest, fast enough, matches requested scope.
2. **Dedicated `task_labels` join table**: better for future filtering/counts, but heavier for no current query requirement.
3. **Project-level label registry with colors**: closest to full GitHub labels, but it adds a new resource, editor surface, and migration complexity not requested here.

The chosen option is task-local JSON. It preserves module boundaries, keeps API and CLI simple, and can migrate to a table later if filtering or colors become important.

## Self-Review

- Spec coverage: API, CLI, Web editor, card display, and skill docs are covered.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: all layers use `labels` as `[]string` / `string[]`.
- Scope: color registries and filtering are explicitly out of scope for this task.
