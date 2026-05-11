# taskline

Agent-friendly task management. Kanban for AI agents, with HTTP API + CLI +
embedded React web UI.

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
│       └── dist/.gitkeep   # placeholder; vite overwrites at build time
├── cli/                    # Go module: cli.taskline.dev (independent)
│   ├── main.go cmd/ client/
├── web/                    # React + Vite + Tailwind + dnd-kit + React Flow
│   ├── src/{components,hooks,lib}/
│   ├── package.json vite.config.ts
├── skills/taskline-management/SKILL.md   # for AI agents
├── scripts/{build,start-local}.sh
├── dist/                   # build output: taskline-server, taskline
├── .env.example            # server runtime config
└── README.md
```

Two Go modules on purpose: the CLI ships without the server's heavy deps
(no SQLite, no Hertz). The web UI is `go:embed`-ed into the server binary
so deployment is one file.

## Quick start

```bash
# One-shot build of everything (web → server bundle → both binaries)
./scripts/build.sh

# Boot the server (SQLite at ./data/taskline.db, port :8787 by default)
cp .env.example .env       # only needed first time
./dist/taskline-server

# UI is at http://127.0.0.1:8787/
# API is under /api/v1/*

# In another shell — drive via CLI
export TASKLINE_PROJECT=demo
./dist/taskline project create --name demo --description "first one"
./dist/taskline task create --title "first task" --type feature --priority 1
./dist/taskline task list
./dist/taskline task next
```

## Web UI

Two views, switchable from the toolbar:

- **Kanban** — six columns (pending / start / design / dev / review /
  done), cards sorted by priority within each column. Drag a card to
  change its state; the server accepts moves in either direction.
  `pending` is a parking lot — tasks there are not runnable, and the
  "+ New task" modal exposes an *Auto-start* toggle (on by default) to
  decide whether a new task lands in `start` or `pending`.
- **Dependency graph** — every task is a node; edges follow `depends_on`.
  Change state from the dropdown on each node.

The UI auto-refreshes every 10 s so changes from the CLI show up
without a manual reload.

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

## Server config

`.env` (read from CWD; process env wins):

```dotenv
TASKLINE_DB=./data/taskline.db
TASKLINE_LISTEN=:8787
TASKLINE_IMAGES_DIR=./data/images
```

## CLI environment

```bash
export TASKLINE_SERVER=http://127.0.0.1:8787   # default if unset
export TASKLINE_PROJECT=demo                   # default --project for task subcommands
```

## Tests

```bash
( cd server && go test ./... )    # unit + e2e (boots real server)
( cd cli    && go test ./... )    # CLI module
```

## Stack

- **Server**: Go + Hertz + SQLite (`modernc.org/sqlite`, no CGO)
- **CLI**: Go + cobra
- **Web**: React 19 + Vite + Tailwind 4 + TanStack Query + @dnd-kit + @xyflow/react

No external runtime services (no Redis/Postgres/Etcd/ES). SQLite is one file.

## License

MIT
