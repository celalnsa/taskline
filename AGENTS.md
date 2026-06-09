# AGENTS.md

Guidance for agents (and humans) working in this repository.

`CLAUDE.md` is a symlink to this file — keep updates here.

For product overview and quick start, see `README.md`. For architecture
internals see `ARCHITECTURE.md`; for the philosophy behind the product
see `PRODUCT.md`.

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
- **State machine.** `pending → start → spec → dev → test → review → done`.
  Movement in either direction is allowed (review surfacing a bug →
  drop back to dev is a real workflow); validation only rejects unknown
  state names. `pending` is a non-runnable parking lot; the entry-point
  state is `start` (formerly `created`). `spec` is for product
  requirements, UX, scope, and acceptance criteria; technical design
  and implementation start in `dev`; full local verification belongs in
  `test`; code review and CI belong in `review`. Tasks created without
  `auto_start` land in `pending`. Lives in `server/api/model/model.go`
  (`CanTransitionTo`).
- **Dependency DAG.** `AddDependency` rejects cycles with 409. Any new
  graph mutation MUST keep the cycle check.
- **Errors.** Store layer returns sentinel errors (`ErrNotFound`,
  `ErrConflict`); the handler maps them to HTTP statuses in
  `writeServiceError`. Don't let raw store errors leak status codes.
- **CLI output.** JSON when stdout is not a TTY (default for agents),
  table when it is. New commands MUST go through `internal/output` —
  don't `fmt.Println` JSON yourself.
- **Time.** Server-side timestamps are `time.Now().UnixMilli()` (int64).
  Don't introduce a different time format.

## Frontend ↔ backend contract

- Domain types in `web/src/lib/api.ts` mirror `server/api/model/model.go`.
  When you add a field on the Go side, update the TS shape and any
  derived constants (e.g. `STATES`, `STATE_LABELS`).
- The web bundle is embedded into the server binary at build time
  (`server/web/embed.go`). The `dist/.gitkeep` placeholder must stay so
  `go:embed all:dist` succeeds on a fresh checkout.

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
| New persisted resource        | as above, plus an `attach<Foo>` helper in `store.go` so `GetTask`/`ListTasks` surface it inline (see `task_links`) |
| New CLI subcommand            | new file under `cli/cmd/`, register in `init()`      |
| New web view                  | `web/src/components/` (page-level lives in `App.tsx`)|
| Change the agent contract     | `skills/taskline-management/SKILL.md` first, then code |
