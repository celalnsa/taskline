---
name: taskline-localtest
description: |
  Use when developing taskline itself (the server, web, or CLI in this
  repo) and you need to verify your changes actually work against a
  real running binary — not just unit tests in isolation. Required
  whenever a change can affect the embedded web bundle, server-side
  state at startup (migrations, embedded SQL), or the test → review
  transition defined in taskline-management's playbook. Trigger
  phrases: "I changed the server code", "I touched the kanban",
  "rebuild and restart", "verify against the running server",
  "smoke-test in the browser".
metadata:
  internal: true
---

# taskline-localtest — verifying taskline changes locally

This skill closes the loop between "tests pass in isolation" and
"the change is actually deployed and correct on the running binary".
It applies whenever you've modified anything in this repo that can
affect runtime behavior — server code, the web bundle (which is
`go:embed`-ed into the server binary), or anything migration-adjacent.

The three steps below are **non-negotiable** before declaring a
feature done. Skipping any one of them is exactly how the
"I tested it but the running server is still on yesterday's binary"
failure mode happens, and it is the failure mode this skill exists
to prevent.

## When to use

- You're developing taskline itself (server / web / CLI).
- A change can affect the running binary's behavior at startup, on a
  request, or in the bundled web UI.

When NOT to use:
- You're just driving an existing taskline via the CLI to manage
  tasks — use `taskline-management` for that.
- The change is documentation-only and touches no code path.

## The three steps

### 1. Write the test FIRST

Before the implementation, write a test that captures the expected
behavior and **watch it fail**. The order matters:

- A test written *after* the code passes immediately — passing proves
  nothing.
- A test that never failed for the right reason may be testing
  something else entirely.

Concrete test placement by area:

| Change area              | Test home                                                         |
| ------------------------ | ----------------------------------------------------------------- |
| Server logic / handlers  | `server/internal/{store,service}/*_test.go` (`:memory:` is fine)  |
| Server end-to-end (HTTP) | `server/tests/e2e_test.go` (boots a real Hertz instance)          |
| Migration / schema       | `server/internal/store/store_test.go` against `t.TempDir()` file  |
| CLI surface              | `cli/...` (uses `httptest.Server`)                                |
| Web                      | TS strict + `pnpm build` is the floor; visual smoke in the browser is the ceiling |
| Skill artifacts          | `scripts/test-skill.sh` (frontmatter + section presence)          |

Run the failing test, confirm the failure message matches what you
expected, then implement.

### 2. Rebuild AND restart the running server

After tests are green in isolation, the next failure mode is "I
forgot the binary is stale". Two things make this trap especially
easy to fall into in this repo:

- The web bundle is `go:embed`-ed into the server binary —
  frontend changes only ship when the **server** is rebuilt. A
  fresh `pnpm build` updates `server/web/dist/`, but until the
  server itself is recompiled and restarted, `:8787` keeps serving
  the old bundle.
- SQLite migration code only runs at startup — server-side
  migration changes only take effect on a **restart**.

The mechanical sequence:

```bash
./scripts/start-local.sh    # rebuilds web bundle + server + CLI, restarts :8787
curl -s http://127.0.0.1:8787/healthz   # expect {"ok":true}
```

`scripts/start-local.sh` defaults to `TASKLINE_LISTEN=:8787`, which binds
all interfaces for LAN/NetBird access. Override with `PORT=...` or
`TASKLINE_LISTEN=0.0.0.0:<port>` when you need a different socket.

Verify the new binary is the one actually listening:

```bash
lsof -i :8787 | head -3                  # confirm only the new PID owns the port
ls -l dist/taskline-server               # timestamp matches this build
curl -s http://127.0.0.1:8787/ | grep -oE 'assets/index-[^"]+\.js'
                                          # bundle hash matches the latest pnpm build
```

Don't skip this step even if you "only changed CSS" — the bundled
hash is what you'd see on `:8787` and it is **different** from what
Vite serves on `:5173` during HMR development.

### 3. Run the FULL test on the restarted binary

"Full" here means: the surfaces affected by this change, exercised
through the actual production code path on the running server.

- **Server code**: `( cd server && go test ./... )` AND a real HTTP
  call against `:8787` covering at least the modified endpoint.
- **Migration**: read `PRAGMA user_version` against the live DB and
  confirm it matches the expected post-migration version. Use the
  configured DB path; if `TASKLINE_DB` was only set in `.env`, export it
  for the shell first:

  ```bash
  set -a; [ -f .env ] && . ./.env; set +a
  sqlite3 "${TASKLINE_DB:-./data/taskline.db}" "PRAGMA user_version;"
  ```

- **Web**: open `http://127.0.0.1:8787/` (**NOT** `:5173`) in a real
  browser. Check the embedded bundle hash matches your build. Test
  the golden path *and* the most likely regressions in adjacent UI
  (drag-and-drop still works, kanban still drops `review → dev` for
  a defect, the URL `?project=<x>` still resolves).
- **CLI**: run the actual command end-to-end against `:8787`, not
  just the Go test. Many CLI bugs hide in the JSON shape, the
  TTY-vs-pipe output detection, or env-var resolution — none of
  which `go test` exercises.

If a step fails, drop the taskline task back to `dev` with
`taskline task update <id> --state dev` and fix the root cause.
Don't paper over it; the bidirectional state machine exists for
exactly this.

## Common failure modes this skill prevents

| Symptom                                                          | Root cause                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| "Tests pass but the UI doesn't show the change"                  | Forgot step 2 — running server has stale embedded bundle              |
| "Migration test passes but live DB has `user_version=0`"         | Forgot to restart the server after the migration code change         |
| "Frontend works in dev (`:5173`) but not in prod (`:8787`)"      | Tested against Vite dev only; embedded bundle was never rebuilt       |
| "Endpoint test passes but real client gets 404"                  | Skipped step 3 — never hit the running binary with a real request    |
| "I dragged a card and got an error I didn't see in unit tests"   | Skipped browser smoke; visual regression only shows in real DOM      |

## Relationship to other skills

- `taskline-management` — the agent-facing skill that drives the CLI
  through `start → spec → dev → test → review → done`. **This** skill
  (`taskline-localtest`) is the concrete checklist for the
  **test → review** transition specifically when developing taskline
  itself.
- The two are complementary: management says "run tests, then advance
  state"; localtest spells out what "tests" actually means for a
  binary that embeds a web bundle and runs migrations at boot.
