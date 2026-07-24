# taskline

Agent-friendly task management. Kanban for AI agents, with HTTP API + CLI +
embedded React web UI.

For canonical vocabulary and lifecycle invariants see
[`DOMAIN.md`](DOMAIN.md). For product rationale and implementation structure see
[`PRODUCT.md`](PRODUCT.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md).

## What it is

A small Go HTTP server (Hertz + SQLite) that exposes a state-machine + dep-DAG
task model, plus a cobra CLI for AI/scripting use, plus a React kanban UI bundled
into the server binary so a single executable serves both API and UI.

## Layout

```
taskline/
├── server/                 # Go module: taskline_server (independent)
│   ├── api/{handler,model,middleware}/
│   ├── internal/{store,service,config}/
│   ├── cmd/taskline-server/
│   ├── migrations/
│   ├── tests/              # e2e (boots real server)
│   └── web/                # go:embed boundary for the bundled UI
│       ├── embed.go
│       └── dist/.gitkeep   # placeholder preserved by web build cleanup
├── cli/                    # Go module: cli.taskline.dev (independent)
│   ├── main.go cmd/ client/
├── web/                    # React + Vite + Tailwind + dnd-kit + React Flow
│   ├── src/{components,hooks,lib}/
│   ├── package.json vite.config.ts
├── skills/taskline-management/SKILL.md   # for AI agents
├── .agents/skills/taskline-localtest/SKILL.md # repo-internal agent test guide
├── scripts/{build,start-local,install-local,test-skill}.sh
├── dist/                   # build output: taskline-server, taskline
├── .env.example            # server runtime config
├── DOMAIN.md               # canonical vocabulary and domain invariants
└── README.md
```

Two Go modules on purpose: the CLI ships without the server's heavy deps
(no SQLite, no Hertz). The web UI is `go:embed`-ed into the server binary
so deployment is one file.

## Quick start

```bash
# One-shot build of everything (web → server bundle → both binaries)
./scripts/build.sh

# Boot the server (after copying .env.example, data lives under ./.cache/data)
cp .env.example .env       # only needed first time
./dist/taskline-server

# UI is at http://127.0.0.1:8787/
# API is under /api/v1/*

# In another shell — drive via CLI
export TASKLINE_PROJECT=demo
./dist/taskline status
# Register only when status reports registered=false, then verify again.
./dist/taskline register --name agent-a
./dist/taskline status
./dist/taskline project create --name demo --description "first one"
./dist/taskline task create --title "first task" --type feature --priority 1 --label onboarding
# --type accepts feature, bug, or docs
./dist/taskline task doc create <task-id> --title Spec --file ./spec.md
./dist/taskline task list
./dist/taskline task next                 # preview only; does not reserve work
./dist/taskline task next --claim --label onboarding
./dist/taskline task update <task-id> --add-label review --append-description "checked locally"
```

## Web UI

Two views, switchable from the toolbar:

- **Kanban** — one column for each
  [canonical lifecycle state](DOMAIN.md#task-lifecycle), with a task count in
  every column header.
  All non-Done columns default to "next execution order" (unblocked first, then
  priority / FIFO), while Done defaults to recently updated first. Every
  column exposes sort controls for execution order, priority high-to-low,
  created oldest-first, and recently updated. Drag a card to
  change its state; the server accepts moves in either direction.
  The "+ New task" modal exposes an *Auto-start* toggle (on by default) to
  choose between offered and
  [parked work](DOMAIN.md#task-lifecycle).
  Task details include Labels, Images, Docs, Links, and Depends sections.
  Labels are GitHub-style task-local chips; Docs are Markdown files that
  can be opened and edited from the task editor.
- **Dependency graph** — every task is a node; edges follow `depends_on`.
  Change state from the dropdown on each node.

The workspace header contains sidebar collapse, task search, view toggle,
and "+ New" controls. `?project=<name|id>` keeps the selected project
shareable; `?view=graph` opens the graph directly while the default
Kanban view keeps the URL clean.

The UI auto-refreshes every 10 s so changes from the CLI show up
without a manual reload.
Click a Kanban card's updated time to inspect its complete operation history,
including actor, exact timestamp, and field-level before/after values.

## Development workflow

Two terminals:

```bash
# Terminal 1 — backend (rebuild if Go source changes)
( cd server && go run ./cmd/taskline-server )

# Terminal 2 — frontend (HMR; vite dev server proxies /api → :8787)
cd web && pnpm install && pnpm dev
```

Open http://localhost:5173 (vite) — it proxies API calls to the Go server.
The server's embedded UI doesn't matter in this mode.

When you want a release-style build:

```bash
./scripts/build.sh   # produces dist/taskline-server + dist/taskline
```

## Local user install

```bash
./scripts/install-local.sh
```

This builds the CLI into `~/.local/bin/taskline`, links public skills
from `skills/` into `~/.agents/skills/` and `~/.claude/skills/`, and
keeps project-internal skills under `.agents/skills/` local to this
checkout.

## Server config

`.env` (read from CWD; process env wins). Built-in defaults use
`./data/...` when no `.env` exists; the checked-in `.env.example`
keeps local runtime files under ignored `./.cache/data/...`:

```dotenv
TASKLINE_DB=./.cache/data/taskline.db
TASKLINE_LISTEN=:8787
TASKLINE_IMAGES_DIR=./.cache/data/images
TASKLINE_DOCS_DIR=./.cache/data/docs
# Optional; otherwise the server reuses `gh auth token` from the local keychain.
TASKLINE_GITHUB_TOKEN=
```

Lifecycle evidence gates are defined in
[`DOMAIN.md`](DOMAIN.md#evidence-gates). The GitHub token lookup order is
`TASKLINE_GITHUB_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`, then the local `gh` login.

## CLI environment

```bash
export TASKLINE_SERVER=http://127.0.0.1:8787   # default if unset
export TASKLINE_PROJECT=demo                   # default --project for task subcommands
```

Agent identity is stored per working directory, not globally:

```bash
taskline status
taskline register --name agent-a  # only when status reports registered=false
taskline status
# writes .config/taskline/agent.json in the current directory
```

`taskline status` is the preflight for agent work. It reports the CLI version,
server health, config directory, default project, registered agent, and that
agent's live claims across projects. A bad or stale token makes the command fail
instead of silently appearing unregistered. Registration also rejects a request
that already carries a valid agent token, preventing accidental identity
replacement.

Queue eligibility, ordering, label filters, and ownership are defined in
[`DOMAIN.md`](DOMAIN.md#dependencies-and-queue-selection) and
[`DOMAIN.md`](DOMAIN.md#claims-and-leases). Operationally, use
`task next --claim` before starting work; plain `task next` is only a preview.
Claim, heartbeat, release, and normal update flows derive owner from the
registered token and do not accept an owner flag.
Use `taskline task history <task-id>` to read the same append-only operation
history from the CLI; JSON output retains structured change details.

`task update` also supports incremental edits for common agent workflows:
`--add-label`, `--remove-label`, and `--append-description` avoid replacing the
entire label set or description.

## Tests

```bash
( cd server && go test ./... )    # unit + e2e (boots real server)
( cd cli    && go test ./... )    # CLI module
( cd web    && pnpm lint && pnpm test && pnpm build )
./scripts/test-skill.sh           # public + internal skill smoke tests
```

## Stack

- **Server**: Go + Hertz + SQLite (`modernc.org/sqlite`, no CGO)
- **CLI**: Go + cobra
- **Web**: React 19 + Vite + Tailwind 4 + TanStack Query + @dnd-kit + @xyflow/react

No external runtime services (no Redis/Postgres/Etcd/ES). SQLite is one file.

## License

MIT
