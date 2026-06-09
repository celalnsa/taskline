---
name: taskline-management
description: |
  Use whenever the user wants to track agent work as structured tasks
  inside a project — capturing a feature or bug, sequencing dependent
  work, picking the next thing to pull, advancing a task through the
  pending → start → spec → dev → test → review → done lifecycle, recording
  progress, or asking "what's left?". Trigger phrases include "create
  a task", "add a feature", "what should I work on next", "block this
  task on …", "mark X as in review / done", "show me the open bugs",
  "park this for later", and any project / kanban / backlog management
  ask. Use even when the user doesn't say "task" or "taskline" —
  phrases like "let's plan this", "queue this up", "track this",
  "what's runnable now" all qualify. If the user explicitly invokes
  this skill with no other instructions, treat it as "work the current
  project queue" and proactively drain runnable tasks to completion.
  Skip for one-off todo notes with no state, dependencies, or follow-up
  — just answer those directly.
version: 0.8.0
---

# taskline — task management for AI agents

The `taskline` CLI is your only interface to taskline. It tracks
projects and the tasks (features / bugs) inside them, enforces a
seven-state lifecycle (`pending → start → spec → dev → test → review → done`),
models inter-task dependencies as a DAG, and answers "what's runnable
now?".

**Always go through the CLI.** Don't `curl` anywhere, don't try to read
or write the database, don't shell out to internal endpoints — even if
the CLI doesn't expose the exact verb you want. If you find a real
gap, file a taskline task to extend the CLI; don't work around it.
Where taskline runs and how it stores data is not your concern.

The CLI is built for agents, not humans at a terminal:

- JSON on stdout when not a TTY (your case). Pass `--format json` to
  force it; you almost never want `--format table`.
- Stable exit codes (0 success, non-zero error). Diagnostics on stderr.
- One subcommand per verb. No interactive prompts.
- If a command fails with "connection refused" or similar, tell the
  user — don't try to start anything yourself.

## When to use

Reach for taskline whenever the user's ask has *structure* — state,
ordering, dependencies, more than one item, "what's next?". Examples:

- "Track this as a feature in `<project>`"
- "What should I pick up next?"
- "Block `<task A>` on `<task B>`"
- "Mark `<id>` review / done"
- "Show me the open bugs / what's still in dev"
- "Wipe the done tasks from `<project>`"
- "Use taskline-management" / "按照 taskline-management skill 执行"

If the user explicitly names or invokes `taskline-management` and gives
no additional instruction, treat that as "work the current project's
runnable queue": resolve the project from `--project`, `$TASKLINE_PROJECT`,
or the current repository name when it is unambiguous. If the project
cannot be resolved, ask only for the project name. Once a project is
known, export `TASKLINE_PROJECT` for the session or pass `--project`
on every project-scoped command, then keep pulling
`taskline task next --format json` after each completed task until it
returns the literal `null`. Do not stop after one task or one PR unless
the runnable queue is exhausted or a real blocker prevents progress.

Skip taskline when the user just wants a one-line note, a scratch
todo, or an answer that doesn't survive past this turn — reply
directly. taskline is the wrong tool for content that has no
follow-up.

## Environment

```bash
export TASKLINE_PROJECT="demo"   # default project so you can omit --project
```

`--project` overrides `$TASKLINE_PROJECT`. A project is referenced by
**name** (`demo`) or **id** (`9b…uuid`) — both work everywhere.
Export `TASKLINE_PROJECT` once at the start of a session that's
focused on a single project.

## Domain model

| Field         | Notes                                                                      |
| ------------- | -------------------------------------------------------------------------- |
| `id`          | UUID, generated for you on create                                          |
| `project_id`  | UUID of owning project                                                     |
| `title`       | required, short                                                            |
| `description` | optional, longer prose                                                     |
| `type`        | `feature` (default) or `bug`                                               |
| `state`       | `pending`, `start`, `spec`, `dev`, `test`, `review`, `done`                |
| `priority`    | integer; **higher = runs sooner** (default 0)                              |
| `depends_on`  | list of task ids; the task is blocked until **every** dep reaches `done`  |
| `images`      | optional binary attachments; each image includes a `url` for retrieval     |
| `docs`        | optional Markdown docs; each doc includes a raw-content `url`              |

**State machine.** Any state may transition to any other named state.
Forward jumps (`start` → `done`) and drop-backs (`review` → `dev`
when a defect surfaces) are both legal. Unknown state names are
rejected — don't invent new ones.
`test` is the local verification stage between implementation and
review: test review, unit tests, API e2e, browser smoke, and any other
checks that should pass before PR review/CI begins.

**`pending` is the parking lot.** Tasks in `pending` are explicitly
**not runnable**: `task next` and `task list --runnable` skip them.
Use it when you want to capture work without offering it to the queue
yet (rough drafts, future ideas, things that need refinement). Any
state may transition into `pending` — drop a task back into the lot
whenever it should stop being a candidate. Move it to `start` (or
further along) when it's ready to be worked.

**Runnable.** A task is runnable when its state is neither `done` nor
`pending` AND every task it depends on has state `done`. Runnable
tasks are returned sorted by `priority DESC`, then `created_at ASC`.
Use `taskline task next` for the single highest-priority runnable
task.

**Dependency DAG.** Adding an edge that would close a cycle is
rejected. Self-deps are rejected. Re-adding an existing edge is a
no-op.

## CLI cheat sheet

`-h` on any subcommand prints flags. This is the full agent surface.

### Projects

```bash
taskline project create --name demo --description "first project"
taskline project list
```

### Tasks

```bash
# Create (defaults to 'start' state — immediately runnable)
taskline task create --project demo --title "first task" --type feature --priority 1

# Create and park in 'pending' (won't show up in `task next`)
taskline task create --project demo --title "later idea" --auto-start=false

# List (filter by state with comma-separated names)
taskline task list --project demo
taskline task list --project demo --state start,dev,test

# Pick / inspect
taskline task next --project demo            # highest-priority runnable, or null
taskline task get <id>

# Mutate (PATCH semantics — only pass the flags you want changed)
taskline task update <id> --state test
taskline task update <id> --priority 5 --description "new prose"
taskline task delete <id>                    # cascades deps + attachments

# Dependencies
taskline task depend <id> --on <other-id>
taskline task undepend <id> --on <other-id>

# Image attachment (any binary)
taskline task upload <id> --file ./screenshot.png

# Markdown docs (stage deliverables, notes, reports)
taskline task doc create <task-id> --title "Spec" --file ./spec.md
taskline task doc get <doc-id>
taskline task doc update <doc-id> --title "Test Report" --file ./test-report.md
taskline task doc delete <doc-id>

# Link (PR, external design doc, ticket, merged commit — any URL to remember)
taskline task link <task-id> --url https://example.com/pr/42 --label "PR #42"

# Remove a link by its id (links are returned inline on `task get`)
taskline task unlink <link-id>
```

Delete returns `{"deleted": true, "id": ...}`; depend returns
`{"task_id": ..., "depends_on": [...]}`. Pipe to `jq` freely.

### Task docs and links

As you walk a task through the playbook you'll generate artifacts that
belong with it. Use task docs for Markdown content owned by the task
itself, and links for external URLs such as PRs, commits, design tools,
or chat threads. Do not keep stage deliverables only in chat history.

Task docs are first-class Markdown files. They surface inline on
`task get` with `url` fields under `/api/v1/docs/<doc-id>/content`;
fetch full editable content with `taskline task doc get <doc-id>`.
Create or update the stage doc before advancing out of the matching
stage:

- **spec → dev:** `Spec` doc with product design, technical design
  (IDL/API definitions and implementation plan), and test plan/test
  cases. If a Superpowers plan already exists, upload that content as
  the task doc.
- **dev → test:** `Dev Notes` doc summarizing implementation, issues
  encountered, and any divergence from the spec/technical design.
- **test → review:** `Test Report` doc reviewing test cases, module
  tests, real e2e/API/CLI/browser/device checks, agent evaluation,
  pass rate, failures, and whether failures require returning to dev.
- **review → done:** `Review Report` doc covering PR comments, CI
  status, whether the implementation still matches the original design,
  and any justified design updates.

Recommended moments to call it:

- **spec/dev/test/review**: create or update the matching Markdown doc.
- **test → review**: link the PR URL just after `gh pr create` ("PR #N").
- **review → done**: the merged-commit URL or anything a future
  reader would want to reach for ("merge", "post-mortem").

Docs and links surface inline on `task get` and in the web detail view.
There is no limit on how many docs or links a task can hold; favour
adding too many over too few — they're cheap to remove later.

## Stage playbook — "work the queue"

When the user says "work the queue" / "do the next task" / "keep
going through the backlog", or explicitly invokes this skill without
more instructions:

1. Run `taskline task next --project <p> --format json`.
2. The CLI emits the bare task object (`id`, `title`, `state`, … as
   top-level fields) on success, or the literal `null` when nothing is
   runnable. If you see `null`, report there's nothing runnable and
   stop.
3. Read `title`, `description`, any `docs`, and any `images`. Each doc
   includes a raw Markdown `url` under `/api/v1/docs/<doc-id>/content`;
   each image includes a `url` under `/api/v1/images/<image-id>`. Fetch
   and surface them when they are material to the task.
4. Walk the task through the stages below in order. Each stage has the
   same shape: **Trigger** (what just happened) → **Actions** (do
   these now) → **Advance** (literal CLI command to move state) →
   **Skip when** (escape clause).
5. Loop back to step 1 — don't pause to ask the user whether to
   continue.

Higher-order capabilities (brainstorming, planning, code review) are
referenced by what they do, with a Superpowers skill name in
parentheses if your harness has them; drop the parenthetical if not
installed.

### start → spec

- **Trigger:** you just picked the task off the queue.
- **Actions:**
  1. `git checkout main && git pull`
  2. `git checkout -b feature/<short-kebab-slug>` (slug from the title;
     keep it under ~30 chars).
  3. Confirm `git status` is clean.
- **Advance:** `taskline task update <id> --state spec`
- **Skip when:** the change qualifies as fast-path (see below) — go
  straight to dev.

### spec → dev

- **Trigger:** branch exists, title + description loaded.
- **Actions:**
  1. Clarify the product contract from the task description, project
     docs, and code context: user need, scope, non-goals, UX or
     interaction behavior, and acceptance criteria. Do not ask the user
     for routine design approval; ask only when missing information
     makes safe implementation impossible.
  2. Capture that contract in a `Spec` task doc before advancing. The
     doc must include product design, technical design (IDL/API
     definitions and implementation plan), and test plan/test cases.
     If you already wrote a Superpowers plan, upload that content as the
     doc rather than duplicating it in the task description.
- **Advance:** `taskline task update <id> --state dev`
- **Skip when:** the change is mechanical (rename, formatting,
  one-line config) — go straight to dev.

### Architecture review without user checkpoints

For routine product/technical choices, do not pause for user approval.
High-quality autonomy still needs a second pass: after you identify
2-3 viable approaches, choose the simplest one that fits the product
goal, then run an architecture review before implementation.

Prefer a separate architect-style subagent when your harness supports
subagents. Give it the task title, description, proposed options,
recommended option, and relevant repo constraints; ask it to check for
over-engineering, unclear boundaries, hidden coupling, performance
risks, testability gaps, and violations of the project's philosophy. If
subagents are not available, perform the same review yourself as an
explicit second pass. The final choice should be simple, declarative,
readable, performant enough for the expected workload, and aligned with
existing module boundaries.

Ask the user only when the product intent is genuinely unknowable from
the task, the decision has external/business consequences, credentials
or destructive permissions are missing, or the safe implementation
cannot proceed without information that is not in the repo or taskline
task. In all other cases, record the chosen approach and reason in the
task description or implementation notes, then continue.

### dev → test

- **Trigger:** product spec / acceptance criteria in hand.
- **Actions** (test-first):
  1. Brainstorm the technical approach — list 2-3 implementation options,
     pick one, and name the tradeoff. No human checkpoint. (capability:
     brainstorming — `superpowers:brainstorming`)
  2. Run the architecture review described above, revise the choice if
     it finds a concrete issue, and keep the final plan simple,
     declarative, readable, and aligned with the project goals.
  3. Plan the technical work — architecture boundary, ordered steps, and
     test strategy. (capability: plan writing —
     `superpowers:writing-plans`)
  4. Write or extend failing tests for the new behavior.
  5. Implement until the focused tests pass and the behavior is ready
     for full local verification.
  6. Create or update a `Dev Notes` task doc summarizing the
     implementation, issues encountered, and any divergence from the
     `Spec` doc with the reason.
- **Advance:** `taskline task update <id> --state test`
- **Skip when:** never. Implementation must be ready for local
  verification before review begins.

### test → review

- **Trigger:** implementation behavior is complete in the local
  worktree.
- **Actions:**
  1. Review the tests you wrote or touched. Add coverage now if the
     behavior, migration path, CLI surface, or UI state can regress.
  2. Run the full project test suite for whatever you touched.
     For this repo: `( cd server && go test ./... )`,
     `( cd cli && go test ./... )`, `( cd web && pnpm lint && pnpm test && pnpm build )`.
     Run `./scripts/test-skill.sh` when skill docs changed. Lint /
     format as the project requires.
  3. For taskline itself, or any project with an embedded frontend,
     migrations, or runtime startup behavior, verify against the rebuilt
     running binary rather than only isolated tests.
  4. Self code-review for bugs, dead code, boundary issues.
     (capability: code review — `code-review:code-review`)
  5. Fix anything the review or tests surface; re-run the relevant
     tests after each fix.
  6. Create or update a `Test Report` task doc with reviewed test
     cases, commands/checks run, pass rate, failures, and whether any
     failures require dropping back to `dev`.
  7. Stage and commit. Conventional, minimal messages.
  8. `git push -u origin <branch>`.
  9. `gh pr create` with title, summary, and a test plan.
  10. Attach the PR URL to the task:
     `taskline task link <task-id> --url <pr-url> --label "PR #N"`
     so anyone reading the task later can jump straight to the
     review.
- **Advance:** `taskline task update <id> --state review`
- **Skip when:** never. Tests are the gate.

### review → done

- **Trigger:** a PR exists for the committed implementation.
- **Actions:**
  1. **Wait for CI** if configured. If it fails, drop the task back to
     `dev`, fix the root cause locally, re-run tests, and push.
  2. **Wait for at least one review** — human or bot
     (`gemini-code-assist`, etc.). Don't merge before any review has
     posted; the whole point of opening a PR is the second pair of
     eyes. Poll with:

     ```bash
     gh pr view <n> --json reviews,reviewDecision,statusCheckRollup
     ```

     Re-check periodically until `reviews` is non-empty.
  3. Read **every** comment surface — one endpoint isn't enough:

     ```bash
     gh api repos/<owner>/<repo>/pulls/<n>/reviews     # bot summaries
     gh api repos/<owner>/<repo>/pulls/<n>/comments    # inline review comments
     gh api repos/<owner>/<repo>/issues/<n>/comments   # top-level PR conversation
     ```

     Address each finding; for real defects, drop the task back to
     `dev`, re-run tests after each batch, and push. If a comment is
     wrong, **reply with reasoning** rather than silently ignoring it.
  4. Create or update a `Review Report` task doc covering PR comments,
     CI status, and whether the implementation still matches the
     original design. If not, either update the design doc with the
     justified change or drop back to `dev` for rework.
- **Advance:** `taskline task update <id> --state done` *only after*
  (a) CI green or N/A, (b) at least one review posted, and
  (c) every reviewer comment addressed or rebutted.
- **Drop back to dev** with `taskline task update <id> --state dev`
  when review or CI surfaces a real defect. The bidirectional state
  machine exists for exactly this — don't delete-and-recreate.

### done — wrap-up

- **Trigger:** PR approved (or all comments addressed) + CI green.
- **Actions:**
  1. `gh pr merge --squash --delete-branch` (or the project's style).
  2. `git checkout main && git pull`
  3. Delete the local feature branch (gh's `--delete-branch` may have
     done this already).
- The taskline task is already `done`; this stage is repo hygiene.

## Fast path

A task qualifies as fast-path when **all** of:

- single file changed,
- no behavior visible to other code,
- no test scaffolding or new dependency.

Examples: typo in a comment, raising a log level, bumping a constant.
The loop collapses to:

```
	start → dev → done
```

No branch, no spec note, no PR. Commit directly on main with a
one-line message. The state machine still records what happened.

## Gotchas

- **Forgot `--project`?** Export `TASKLINE_PROJECT` once at session
  start. Only `task create`, `task list`, and `task next` accept
  `--project` — the rest (`get`, `update`, `delete`, `depend`,
  `upload`) operate on the task id directly and reject the flag with
  "unknown flag".
- **`invalid next state "..."`** — you used a name that isn't in
  `pending/start/spec/dev/test/review/done`. The state `created` was
  renamed to `start`, and `design` was renamed to `spec`; don't
  reintroduce old names.
- **`dependency would create a cycle`** — the edge would loop back.
  Restructure the graph or pick a different anchor.
- **`project name "X" already exists`** — name collision. Reuse the
  existing project (likely what you wanted) or pick a new name.
- **`error: project required`** — neither `--project` nor
  `$TASKLINE_PROJECT` is set.
- **`task next` returned `null`** — nothing runnable. Either the
  project is empty, every non-done task is blocked, or everything
  left is parked in `pending`. Run
  `taskline task list --project <p> --state pending,start,spec,dev,test,review`
  to see what's stuck and why. Do not automatically move `pending`
  tasks into `start`; promote them only when the task description,
  dependencies, or the user makes clear that they are ready to run.
- **The user said "remind me to X"** — that's a one-off note, not a
  task. Reply directly; don't create a taskline entry.
