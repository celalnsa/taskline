# AGENTS.md

Guidance for agents (and humans) working in this repository.

`CLAUDE.md` is a symlink to this file — keep updates here.

For product overview and quick start, see `README.md`. For canonical domain
language and invariants see `DOMAIN.md`; for architecture internals see
`ARCHITECTURE.md`; for the philosophy behind the product see `PRODUCT.md`.

## Repo layout (TL;DR)

- `server/` — Go module `taskline_server`. HTTP API + SQLite store.
  Embeds the bundled web UI via `go:embed`.
- `cli/` — Go module `cli.taskline.dev`. Cobra CLI talking to the server
  over HTTP. Independent module so it ships without SQLite/Hertz.
- `web/` — React + Vite + Tailwind frontend. `pnpm build` writes into
  `server/web/dist/` so the server picks it up.
- `skills/taskline-management/SKILL.md` — agent-facing skill that drives
  the CLI. Source of truth for "how an agent should use taskline".
- `.agents/skills/taskline-localtest/SKILL.md` — repo-internal skill for
  verifying changes against a rebuilt, running taskline binary.
- `scripts/build.sh` — one-shot release build (web → server → CLI).
- `scripts/install-local.sh` — user-local CLI install plus public skill
  symlink refresh.
- `scripts/test-skill.sh` — smoke tests for public and internal skill docs.

## Recommended skills and workflow

For routine Taskline queue work, stay autonomous: use the methods below without
invoking a skill that requires user approval unless its own trigger applies.

- **Brainstorming method.** Before non-mechanical work, compare 2-3 approaches
  and choose the simplest one that fits the product contract. Invoke the full
  `superpowers:brainstorming` skill only when the user explicitly wants an
  interactive design session and approval checkpoints.
- **TDD method.** For behavior changes and bug fixes, work in small
  red-green-refactor slices through public interfaces. Invoke `tdd` or
  `superpowers:test-driven-development` only when the user explicitly requests
  a test-first/TDD workflow; otherwise do not add user checkpoints.
- **Codebase design.** Use an implementation-oriented `codebase-design` skill,
  when available, for cross-module or ownership changes. Otherwise run the
  architecture subagent/self-review required by the Taskline workflow.
  `improve-codebase-architecture` is for an explicit architecture audit or
  refactoring-opportunity request, not routine implementation planning.
- **Domain modeling.** Invoke `domain-modeling`, when available and its trigger
  matches, for vocabulary, lifecycle, queue, claim, or dependency changes.
  Update `DOMAIN.md` with the behavior change.

Do not invoke `superpowers:writing-plans` for routine Taskline work: its default
output is repository process files. Keep implementation plans and stage
artifacts in Taskline task docs instead.

Mechanical docs, formatting, or one-line configuration changes do not need the
full workflow. Keep their verification proportional to risk.

Skills have two publication layers. `skills/` contains public, installable
agent contracts and is linked into user-level skill directories by
`scripts/install-local.sh`. `.agents/skills/` contains repository-only skills
with `metadata.internal: true`; they may depend on this checkout's internals and
must not be installed globally.

## Build, run, test

```bash
# Full release-style build (writes ./dist/{taskline-server,taskline})
./scripts/build.sh

# Server only (without web bundle — fine for backend work)
( cd server && go run ./cmd/taskline-server )

# Frontend with HMR (proxies /api → :8787)
( cd web && pnpm install && pnpm dev )

# Tests
( cd server && go test ./... )    # unit + e2e (boots a real server)
( cd cli    && go test ./... )
( cd web    && pnpm lint && pnpm test && pnpm build )
./scripts/test-skill.sh
```

`scripts/start-local.sh` builds the binaries and (re)starts the server in
the background, logging to `.log/server.log` and writing the PID to
`.log/server.pid`. It frees the configured port (default `8787`,
override with `PORT` or `TASKLINE_LISTEN`) by killing only the LISTEN
holder before relaunching.

`scripts/install-local.sh` builds the CLI into `~/.local/bin/taskline`,
links public skills from `skills/` into `~/.agents/skills/` and
`~/.claude/skills/`, and removes old global symlinks that used to point
at this checkout. Project-internal skills stay under `.agents/skills/`
and are not installed globally.

## Module boundaries (don't break these)

- The CLI module **must not import** anything from the server module.
  CLI ↔ server contract is JSON over HTTP only. Shared shapes are
  duplicated in `cli/client/client.go` (intentional — keeps CLI deps
  light, no CGO chain through SQLite).
- `web/` is a pure frontend. It only knows about REST endpoints under
  `/api/v1/*`; the dev server proxies them. Don't bundle Go-side code
  paths into the React app.
- The server's package layering is `cmd → handler → service → store`,
  one direction only. `model` (domain types) is the only package every
  layer may import.

## Conventions

- **No CGO.** SQLite via `modernc.org/sqlite`. Never introduce a CGO
  dependency — it breaks cross-compile and the `go run` workflow.
- **State machine.** Preserve the lifecycle and evidence invariants in
  `DOMAIN.md`. State membership lives in `server/api/model/model.go`
  (`CanTransitionTo`); target entry rules live in
  `server/internal/service/workflow.go`. New rules belong in the service
  registry, and `--force` must never bypass workflow evidence.
- **Dependency DAG.** Preserve the graph invariants in `DOMAIN.md`.
  `AddDependency` rejects cycles with 409; any new graph mutation MUST keep the
  cycle check.
- **Errors.** Store layer returns sentinel errors (`ErrNotFound`,
  `ErrConflict`); the handler maps them to HTTP statuses in
  `writeServiceError`. Don't let raw store errors leak status codes.
- **CLI output.** JSON when stdout is not a TTY (default for agents),
  table when it is. New commands MUST go through `internal/output` —
  don't `fmt.Println` JSON yourself.
- **Agent preflight.** Run `taskline status` before registering or claiming.
  Register only when it reports `registered=false`; invalid identity or token
  errors must be fixed instead of silently replacing the local agent.
- **Time.** Server-side timestamps are `time.Now().UnixMilli()` (int64).
  Don't introduce a different time format.
- **Task docs.** Markdown task docs live on disk under `TASKLINE_DOCS_DIR`
  and are referenced by `task_docs.storage_path`. Keep file IO in the
  handler/config boundary; the store should only persist metadata and
  attach doc rows to task reads.
- **Task labels.** Labels follow `DOMAIN.md` and are stored as JSON on the
  `tasks` row. They are not a project-level registry yet; keep create/update
  support in the normal task API/CLI/editor flow.
- **Task history.** Every task mutation appends a `task_events` row through
  the service-layer recorder. Keep actor/action/summary/change construction in
  `internal/service`; the store only persists and lists events. Event task IDs
  deliberately have no FK so history survives task deletion.

## Frontend ↔ backend contract

- Domain types in `web/src/lib/api.ts` mirror `server/api/model/model.go`.
  When you add a field on the Go side, update the TS shape and any
  derived constants (e.g. `STATES`, `STATE_LABELS`).
- The web bundle is embedded into the server binary at build time
  (`server/web/embed.go`). The `dist/.gitkeep` placeholder must stay so
  `go:embed all:dist` succeeds on a fresh checkout. The web `prebuild`
  step removes generated assets while preserving that placeholder.

## Tests you should run before declaring done

- `( cd server && go test ./... )` — unit + `tests/e2e_test.go` boots a
  real server on a random port.
- `( cd cli && go test ./... )` — covers the CLI surface.
- `./scripts/test-skill.sh` when skill docs or install behavior changes.
- For UI changes, `( cd web && pnpm lint && pnpm test && pnpm build )`.
  Manual smoke-test in the browser if the change touches the kanban DnD
  or the React Flow graph.

## Don't

- Don't add Postgres / Redis / external services. The whole point is one
  binary + one SQLite file. If you think you need a queue, you don't.
- Don't introduce new task states without updating `model.go`,
  `STATES`/`STATE_LABELS` in `web/src/lib/api.ts`, the schema CHECK
  constraint, the SKILL.md state list, and any state-keyed dictionary
  in the web components — keep the canonical set in lockstep.
- Don't write to `server/web/dist/` by hand — `pnpm build` owns it.
- Don't add a second auth layer. taskline is single-user and local; CORS
  is intentionally permissive.

## Where to add things

| Need to add…                  | Put it in                                            |
| ----------------------------- | ---------------------------------------------------- |
| New REST endpoint             | `server/api/handler/handler.go` + service method     |
| New persisted field           | migration in `server/migrations/` + matching schema in `server/internal/store/schema/` + `model.Task`/`Project` |
| New persisted resource        | as above, plus an `attach<Foo>` helper in `store.go` so `GetTask`/`ListTasks` surface it inline (see `task_links` / `task_docs`) |
| New CLI subcommand            | new file under `cli/cmd/`, register in `init()`      |
| New web view                  | `web/src/components/` (page-level lives in `App.tsx`)|
| Change the agent contract     | `skills/taskline-management/SKILL.md` first, then code |
