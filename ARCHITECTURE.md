# Architecture

How taskline is wired together. For the *why* see `PRODUCT.md`; for
build/test/contribution mechanics see `AGENTS.md`.

## Components

```
   ┌──────────────────┐         HTTP /api/v1/*         ┌──────────────────┐
   │   taskline CLI   │  ────────────────────────────▶ │ taskline-server  │
   │  (cobra, JSON-   │ ◀────────────────────────────  │  (Hertz + SQLite)│
   │   first output)  │            JSON                │                  │
   └──────────────────┘                                │  ┌────────────┐  │
                                                       │  │ embedded   │  │
   ┌──────────────────┐         HTTP /api/v1/*         │  │ React UI   │  │
   │   Browser (UI)   │ ◀────────────────────────────▶ │  │ (go:embed) │  │
   │  React + Vite    │       static + REST            │  └────────────┘  │
   └──────────────────┘                                └──────────────────┘
                                                                │
                                                                ▼
                                                       ┌──────────────────┐
                                                       │  ./data/         │
                                                       │   ├ taskline.db  │
                                                       │   └ images/<id>/ │
                                                       └──────────────────┘
```

One binary (`taskline-server`) serves both the REST API and the React
SPA. SQLite is one file on disk; image attachments live alongside it as
plain files keyed by task id.

## Server layering

`server/` is a single Go module with a strict downward-only import
graph:

```
  cmd/taskline-server/         ← process entrypoint, slog, config wiring
       │
       ▼
  api/handler/                 ← Hertz routes, JSON encode/decode, CORS,
       │                         SPA fallback, status-code mapping
       ▼
  internal/service/            ← name resolution (id-or-name), state-machine
       │                         validation, runnable filter orchestration
       ▼
  internal/store/              ← SQLite. CRUD, dep DAG, cycle check.
       │                         Returns ErrNotFound / ErrConflict sentinels.
       ▼
  api/model/                   ← Project, Task, TaskState, TaskType.
                                 Imported by every layer; imports nothing.
```

`internal/config/` is a sibling of service/store: it's loaded by `cmd/`
once and passed through to the handler (for `ImagesDir`).

### Why the split

- The handler layer never touches SQL. It maps HTTP ↔ service calls and
  errors ↔ statuses, nothing else.
- The service layer never touches HTTP. It owns invariants (state
  transitions, project resolution by id-or-name) and calls the store.
- The store layer is the only place that knows about SQLite. It returns
  sentinel errors so the handler can map them to status codes without
  string matching.

## Data model

```sql
projects(id, name UNIQUE, description, created_at, updated_at)
tasks   (id, project_id → projects.id, title, description,
         type ∈ {feature,bug},
         state ∈ {pending,start,spec,dev,review,done}, priority,
         created_at, updated_at)
task_deps   (task_id → tasks.id, depends_on_task_id → tasks.id,
             PRIMARY KEY(task_id, depends_on_task_id),
             CHECK(task_id ≠ depends_on_task_id))
task_images (id, task_id → tasks.id, filename, mime_type,
             size_bytes, storage_path, uploaded_at)
```

All FKs `ON DELETE CASCADE`. Cascade is what makes
`DELETE /api/v1/tasks/:id` "just work" without app-level cleanup.

Indexes:
- `idx_tasks_project_state(project_id, state)` — list-by-state filter
- `idx_tasks_priority(project_id, priority DESC)` — runnable ordering
- `idx_task_deps_dep(depends_on_task_id)` — reverse-dep traversal

Schema lives twice: once at `server/migrations/0001_init.sql` (for tools
that read the migration history) and once at
`server/internal/store/schema/0001_init.sql` (`go:embed`-ed into the
binary so a fresh database can be created without shipping the migrations
directory). Keep them identical.

## State machine

```
pending ⇄ start ──▶ spec ──▶ dev ──▶ review ──▶ done
              ▲         ▲         ▲        ▲
              └─────────┴─────────┴────────┘
              any move between known states is allowed
              any state may also transition into pending
```

Implemented as a membership set in `model.stateOrder`. `CanTransitionTo`
only rejects unknown state names — direction is the agent's call. The
service layer enforces validation before calling `store.UpdateTask`.
Jumping `start → done` is intentional (close trivial work without
ceremony); dropping `review → dev` is intentional too (a review can
surface a defect that legitimately reopens the implementation).

`pending` lives off the main pipeline: tasks created without
`auto_start=true` land there, and any state may transition into it to
"park" work. The runnable query skips both `done` and `pending`.

There's no automatic transition triggered by completing dependencies —
"runnable" is a *query*, not a state. State only moves when an agent
(or human) PATCHes the task.

## Dependency DAG and the runnable query

`task_deps` is a many-to-many edge table. The runnable filter is a
single SQL query:

```sql
SELECT … FROM tasks t
 WHERE t.project_id = ?
   AND t.state NOT IN ('done','pending')
   AND NOT EXISTS (
         SELECT 1 FROM task_deps d
           JOIN tasks dt ON dt.id = d.depends_on_task_id
          WHERE d.task_id = t.id AND dt.state <> 'done'
   )
 ORDER BY t.priority DESC, t.created_at ASC;
```

Cycle prevention is application-side: before inserting an edge
`(task → dep)`, the store walks `dep`'s transitive deps and refuses if
it can reach `task`. SQLite has no native graph reachability, and the
DAG is small enough that a DFS per insert is fine.

Adding an existing edge is a no-op (the unique-key violation is caught
and swallowed) so dependency-add is idempotent for agents retrying on
network blips.

## Web UI delivery

`server/web/embed.go` exposes the bundle via two paths, in priority:

1. **Embedded** (`//go:embed all:dist`) — the production path. `pnpm
   build` writes into `server/web/dist/`; `go build` rolls it into the
   binary. A `.gitkeep` placeholder lets `go:embed` succeed on a fresh
   checkout where `pnpm build` hasn't run yet, and `FS()` detects the
   placeholder-only case and falls through.
2. **External `./dev-web/`** — if a directory by that name exists next
   to the running binary, it's served from disk. Useful for iterating on
   the UI without rebuilding the server.

When both miss, the server runs API-only and `serveUI` returns 404.

The handler registers API routes first, then mounts `serveUI` as a
catch-all on `NoRoute`. Unknown paths fall through to `index.html` so
the SPA's client-side router handles deep links.

## CLI ↔ server protocol

The CLI is a thin REST wrapper. `cli/client/client.go` is a hand-written
HTTP client (no codegen, no shared types) so the CLI module can stay
independent of the server module. Domain shapes are duplicated and kept
in sync by hand — drift here is the single most likely place for bugs,
so a CLI-side e2e test suite exercises the round-trip.

Output formatting is centralized in `cli/internal/output`:

- `Resolve(flag)` picks JSON when stdout isn't a TTY (the default for
  agents), table otherwise.
- `Render` takes both a JSON value and a table-rendering closure so each
  command declares both shapes once.

## Configuration

Server config (`server/internal/config/config.go`) is environment
variables with optional `.env` overlay (process env wins). All paths
auto-`MkdirAll` on first boot:

- `TASKLINE_DB` — SQLite file (default `./data/taskline.db`)
- `TASKLINE_LISTEN` — listen addr (default `:8787`)
- `TASKLINE_IMAGES_DIR` — image storage root (default `./data/images`)

CLI config:

- `TASKLINE_SERVER` — base URL (default `http://127.0.0.1:8787`)
- `TASKLINE_PROJECT` — default `--project` value (so agents don't have
  to pass it on every subcommand)

## Concurrency

`db.SetMaxOpenConns(1)`. SQLite under `modernc.org/sqlite` doesn't
reliably share PRAGMA state across connections, so we serialize access.
For a single-user, single-agent workload this is the right tradeoff —
correctness over throughput. WAL is enabled so reads don't block writes
within that single connection's transaction queue.

If contention ever matters, lift the cap and move PRAGMA setup into a
connection initializer.

## Test strategy

- **Unit**: `service_test.go` and `store_test.go` cover happy paths and
  edge cases (cycle rejection, invalid-state rejection, idempotent dep
  insert). `:memory:` SQLite for speed.
- **End-to-end**: `server/tests/e2e_test.go` boots a real Hertz server
  on a random port and exercises the HTTP surface, including the SPA
  fallback. This is the regression net for handler ↔ service wiring.
- **CLI**: lives in the CLI module; uses an `httptest.Server` to fake
  the backend.
