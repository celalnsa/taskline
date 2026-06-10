# GitHub-Style Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make task labels feel GitHub-style in the web UI by giving labels deterministic theme colors and adding a selectable common-label dropdown while preserving free text entry.

**Architecture:** Keep labels task-local and backend-agnostic. Add a small frontend label helper that owns common labels and theme selection, then reuse it from the task card and task editor. The task API, CLI, and storage contract remain unchanged.

**Tech Stack:** React 19, Tailwind 4 utility classes, Vitest + Testing Library, Playwright browser smoke.

---

## Product Design

Task labels should remain plain strings in API/storage, but the web UI should present them as GitHub-style chips:

- Known/common labels get readable, distinct color themes.
- Unknown labels still get a deterministic theme from a small palette, so cards do not collapse back to a single gray style.
- The editor keeps the existing input flow: typing a label and pressing Enter or comma still adds it.
- The editor adds a common-label dropdown next to the input. Choosing an option adds that label immediately.
- Already-selected common labels are hidden from the dropdown.
- The existing 20-label and 64-character editor limits continue to apply.

## Technical Design

### Approach Options

1. **Backend/project-level registry**
   - Pros: shared presets could become user-configurable later.
   - Cons: requires migrations/API/CLI/web changes and turns a UI improvement into a data-model feature.

2. **Frontend-local constants and deterministic themes**
   - Pros: smallest surface, no storage migration, easy to test, matches current task-local label model.
   - Cons: presets are compiled into the web bundle until a future registry exists.

3. **CSS-only hash-free styling**
   - Pros: no helper module.
   - Cons: repeated logic across card/editor and arbitrary labels remain hard to color consistently.

Chosen approach: option 2. It gives the requested GitHub-style feel without changing the label persistence contract added in the previous task.

### Files

- Create `web/src/lib/labels.ts`
  - Export `COMMON_TASK_LABELS`.
  - Export `getTaskLabelTheme(label)` for deterministic theme metadata.
  - Export small class helpers for chip/option rendering.
- Create `web/src/lib/labels.test.ts`
  - Verify common labels map to named themes.
  - Verify arbitrary labels map deterministically.
- Modify `web/src/components/TaskCard.tsx`
  - Replace the uniform gray label chip with theme classes from the helper.
  - Keep overflow behavior unchanged.
- Modify `web/src/components/TaskCard.test.tsx`
  - Assert visible label chips expose different themes for common labels.
- Modify `web/src/components/TaskEditor.tsx`
  - Use themed chips in the selected-label list.
  - Add a dropdown button and menu of common labels.
  - Hide labels already selected.
  - Disable dropdown when label count reaches 20.
- Modify `web/src/components/TaskEditor.test.tsx`
  - Verify selecting a common label from the dropdown adds it to the payload.
  - Verify selected labels disappear from the dropdown.
  - Verify the dropdown is disabled at the 20-label cap.

## Test Plan

- RED: add focused web tests for label helper, task card themed chips, and editor common-label dropdown.
- GREEN: implement the helper and component changes until focused tests pass.
- Full local verification:
  - `cd web && mise exec -- pnpm lint && mise exec -- pnpm test -- --run && mise exec -- pnpm build`
  - `cd server && mise exec -- go test ./...`
  - `cd cli && mise exec -- go test ./...`
  - `./scripts/test-skill.sh` only if skill docs change.
- Runtime verification:
  - `mise exec -- ./scripts/start-local.sh`
  - Browser smoke against `http://127.0.0.1:8787`: create or edit a task, add a common label from dropdown, add a custom label from input, confirm themed chips appear on the card and the API saves both labels.

## Implementation Tasks

### Task 1: Label Theme Helper

**Files:**
- Create: `web/src/lib/labels.ts`
- Create: `web/src/lib/labels.test.ts`

- [ ] Write failing helper tests for named and arbitrary label themes.
- [ ] Run `cd web && mise exec -- pnpm test -- --run src/lib/labels.test.ts` and confirm RED.
- [ ] Implement `COMMON_TASK_LABELS`, theme mapping, deterministic fallback, and class helpers.
- [ ] Re-run the helper test and confirm GREEN.

### Task 2: Themed Label Chips

**Files:**
- Modify: `web/src/components/TaskCard.tsx`
- Modify: `web/src/components/TaskCard.test.tsx`

- [ ] Write failing card tests proving common labels render with distinct theme metadata.
- [ ] Run `cd web && mise exec -- pnpm test -- --run src/components/TaskCard.test.tsx` and confirm RED.
- [ ] Apply helper classes to card label chips.
- [ ] Re-run the card tests and confirm GREEN.

### Task 3: Common Label Dropdown

**Files:**
- Modify: `web/src/components/TaskEditor.tsx`
- Modify: `web/src/components/TaskEditor.test.tsx`

- [ ] Write failing editor tests for opening the common-label menu, selecting a preset, hiding already-selected presets, and disabling the menu at 20 labels.
- [ ] Run `cd web && mise exec -- pnpm test -- --run src/components/TaskEditor.test.tsx` and confirm RED.
- [ ] Implement the dropdown with selectable preset buttons and themed selected chips.
- [ ] Re-run the editor tests and confirm GREEN.

### Task 4: Full Verification and Runtime Smoke

**Files:**
- No production files unless verification finds a bug.

- [ ] Run full web lint/test/build.
- [ ] Run server and CLI tests as regression checks.
- [ ] Start the rebuilt local server on `*:8787`.
- [ ] Browser-smoke the editor dropdown plus free-text input.
- [ ] Create a Test Report task doc before opening the PR.

## Acceptance Criteria

- Task cards show labels with multiple stable theme styles, not one uniform gray style.
- The editor shows selected labels with the same theme language as cards.
- The editor offers a dropdown of common GitHub-style labels.
- Selecting a common label adds it without typing.
- Users can still type arbitrary labels and press Enter or comma.
- Existing limits, dedupe, save payloads, and overflow display keep working.
