---
name: taskline-management
description: |
  Use whenever the user wants to track agent work as tasks — planning a
  feature, recording bugs, sequencing dependent work, picking the next
  thing to do, or asking "what's left on this project?". The skill drives
  the `taskline` CLI which talks to a local taskline-server (HTTP, SQLite).
  Trigger phrases include "create a task", "add a feature", "what should
  I work on next", "block this task on …", "mark X done", "show me the
  open bugs", or any project / kanban management ask routed at the agent.
user-invocable: false
version: 0.1.0
---

# taskline — task management for AI agents

You are the operator of a local **taskline** instance: a small HTTP server
backed by SQLite, fronted by a CLI named `taskline`. taskline tracks
projects and the tasks (features / bugs) inside them, supports an explicit
state machine (`created → design → dev → review → done`), models
inter-task dependencies as a DAG, and exposes a "what's runnable now"
query that respects priority and blocked-on relationships.

The tool is designed to be driven by you, not by a human in a UI. Output
is JSON-first when stdout is not a TTY. Stable exit codes (0 success,
non-zero error). Diagnostics go to stderr.

## When to use this skill

Invoke any time the user touches task state:

- "Track this as a feature in <project>"
- "What's the next task I should pick up?"
- "Block <task A> on <task B>"
- "Mark <task X> as in review"
- "Show me what's still open"
- "Wipe the done tasks from <project>"

If the user only wants a one-off note or todo line, this is the wrong
tool — just reply directly. taskline is for work that has structure
(state, dependencies, multiple items, priority).

## Setup (only the first time on a machine)

The CLI talks to a server. Make sure both are built once per machine:

```bash
# In the taskline repo root
go build -o bin/taskline-server ./cmd/taskline-server
( cd cli && go build -o ../bin/taskline . )
```

Server config comes from a `.env` file in the directory you launch the
server from (or the process environment). Defaults are sensible for
local use:

```dotenv
# .env (next to the binary)
TASKLINE_DB=./data/taskline.db
TASKLINE_LISTEN=:8787
TASKLINE_IMAGES_DIR=./data/images
```

Start the server in a long-running terminal or under launchd / systemd:

```bash
./bin/taskline-server
```

The CLI defaults to `http://127.0.0.1:8787`. Override with `--server`
flag or `TASKLINE_SERVER` env var.

## Standard environment knobs

Set these once per shell so you don't have to repeat `--project`:

```bash
export TASKLINE_SERVER="http://127.0.0.1:8787"   # default base URL
export TASKLINE_PROJECT="demo"                   # default project for task subcommands
```

The `--project` flag overrides `$TASKLINE_PROJECT`. Anything that
references a project accepts either the **name** (`demo`) or the **id**
(`9b...uuid`).

## Domain model

### Project

A workspace that owns tasks. Names are unique. Has an optional
description.

### Task

| Field        | Notes                                                                |
| ------------ | -------------------------------------------------------------------- |
| `id`         | UUID, server-assigned                                                |
| `project_id` | UUID of owning project                                               |
| `title`      | required, short                                                      |
| `description`| optional, longer prose                                               |
| `type`       | `feature` (default) or `bug`                                         |
| `state`      | `created` → `design` → `dev` → `review` → `done`                     |
| `priority`   | integer, **higher = runs sooner** (default 0)                        |
| `depends_on` | list of task ids (the task is blocked until each dep reaches `done`) |
| `images`     | optional binary attachments per task                                 |

### State machine

State moves between any of the five known names. Forward jumps (e.g.
`created` → `done`) and drop-backs (`review` → `dev` when a defect
surfaces) are both accepted. The server only rejects unknown state
names with HTTP 400.

### Runnable

A task is *runnable* when (a) its state is not `done`, and (b) every
task it depends on **is** in state `done`. The server returns runnable
tasks sorted by `priority DESC` then `created_at ASC` — call
`taskline task next` for the single highest-priority runnable task.

### Dependency DAG

Adding a dependency that would close a cycle is rejected with HTTP 409.
A task may not depend on itself. Re-adding an existing edge is a no-op.

## CLI cheat sheet

`-h` on any subcommand prints flags. The shapes below are the AI-facing
contract; the CLI is intentionally narrow.

### Projects

```bash
taskline project create --name demo --description "first project"
taskline project list
```

### Tasks

```bash
# Create
taskline task create --project demo --title "first task" --type feature --priority 1

# List
taskline task list --project demo                       # all
taskline task list --project demo --state created,dev   # filter

# Inspect / pick the next runnable task
taskline task get <id>
taskline task next --project demo

# Mutate
taskline task update <id> --state review
taskline task update <id> --priority 5 --description "new prose"
taskline task delete <id>

# Dependencies
taskline task depend <id> --on <other-id>

# Image attachment (any binary, not strictly an image)
taskline task upload <id> --file ./screenshot.png
```

### Output formatting

- Default: **JSON** when stdout is not a TTY (your case as an agent),
  **table** when run by a human.
- Force with `--format json` or `--format table`.
- All structured commands return JSON objects with stable shapes; the
  delete + dependency commands return `{"deleted": true, "id": ...}` /
  `{"task_id": ..., "depends_on": ...}` so you can pipe into `jq`.

## Recommended agent loop

When asked to "work the queue":

1. `taskline task next --project <p> --format json` — get a single task.
2. If `task` is `null`, report there's nothing runnable and stop.
3. Read `title` + `description` (and `images` if present — server
   stores them under `$TASKLINE_IMAGES_DIR/<task-id>/`).
4. Move the task forward as you progress:
   - Start working: `taskline task update <id> --state dev`
   - Hand off to review: `taskline task update <id> --state review`
   - Finished: `taskline task update <id> --state done`
5. Loop back to step 1.

This is intentionally chatty so the user can watch state in another
terminal via `taskline task list`.

## Failure modes you will see

| Symptom                                                  | Cause / fix                                                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `server <port>: connection refused`                      | server not running — start `./bin/taskline-server` (or `systemctl --user start taskline`)                |
| `server 404: project ... does not exist`                 | typo'd `--project`; run `taskline project list` to confirm                                               |
| `server 400: invalid next state "..."`                   | unrecognized state name (e.g. `test` was retired) — pick one of `created/design/dev/review/done`         |
| `server 409: dependency would create a cycle`            | the dep edge would loop back; restructure or pick a different anchor task                                |
| `server 409: project name "X" already exists`            | name collision; pick a different name or reuse the existing project (it's likely what you want)          |
| `error: project required (--project or $TASKLINE_PROJECT)` | export `TASKLINE_PROJECT` once at session start to avoid repeating the flag                              |

## What this skill is not

- Not a UI-driven kanban. There is no board view; the model is the
  truth, queries are programmatic.
- Not a multi-tenant SaaS. SQLite, single-user, runs on your machine.
- Not a project planner. taskline tracks **what to do next**, not
  spec authoring or dependency derivation. You bring the structure.
- Not a CI / orchestration runner. State changes are purely
  declarative — taskline does not invoke the work, you do.

## API reference (for direct HTTP use)

Useful when scripting outside the CLI. Base URL defaults to
`http://127.0.0.1:8787`.

| Method | Path                                            | Notes                                          |
| ------ | ----------------------------------------------- | ---------------------------------------------- |
| GET    | `/healthz`                                      | liveness                                       |
| POST   | `/api/v1/projects`                              | body: `{name, description}`                    |
| GET    | `/api/v1/projects`                              | returns `{projects: [...]}`                    |
| POST   | `/api/v1/projects/:project/tasks`               | body: `{title, description, type, priority}`   |
| GET    | `/api/v1/projects/:project/tasks?state=a,b`     | optional comma-separated state filter          |
| GET    | `/api/v1/projects/:project/tasks/runnable`      | returns `{tasks: [...]}`                       |
| GET    | `/api/v1/projects/:project/tasks/next`          | returns `{task: ...|null}`                     |
| GET    | `/api/v1/tasks/:id`                             | full task incl. deps + images                  |
| PATCH  | `/api/v1/tasks/:id`                             | partial update; pointer fields only            |
| DELETE | `/api/v1/tasks/:id`                             | cascades                                       |
| POST   | `/api/v1/tasks/:id/deps`                        | body: `{depends_on}`                           |
| POST   | `/api/v1/tasks/:id/images`                      | multipart form-data, field name `file`         |
