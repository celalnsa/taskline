# Product

The motivation behind taskline. For *what's wired to what* see
`ARCHITECTURE.md`; for *how to work in the repo* see `AGENTS.md`.

(Previously named `DESIGN.md`; renamed because that filename is
conventionally a UI / visual design spec, while this doc is the
product-philosophy doc.)

## The problem

AI agents that do real work need a queue. Not a chat log, not a todo
list — an actual structured work item store that survives across
sessions, can express "X blocks Y", supports multiple parallel agents,
and is cheap to query for "what's the next thing I should pick up?".

Existing options all fail one of three constraints:

1. **SaaS kanbans** (Linear, Jira, …) — built for humans, slow to
   automate, require auth tokens, network round-trips, rate limits, and
   schemas that don't match the way an agent thinks about work.
2. **Markdown todos** (`TODO.md`, GitHub Issues drafts) — no state
   machine, no dependency tracking, no cheap "what's runnable" query,
   and they get out of date the moment the agent crashes mid-task.
3. **General-purpose project tools** (Asana, Trello, Notion DBs) — too
   much surface, too little structure where it counts. Agents don't
   need 14 view modes, they need a single canonical answer for "what's
   next".

taskline is the smallest thing that fills the gap: a state machine, a
DAG, a priority field, and a JSON-first CLI.

## Product principles

### 1. Agent-first, human-second

The CLI defaults to JSON output when stdout isn't a TTY. Exit codes are
stable. Diagnostics go to stderr. The server's contract is small enough
to memorize: seven states, two task types, one priority integer, one
edge type. A human-friendly UI exists, but it's a *visualization* layer
on top of the agent contract — never the source of truth.

This shows up in dozens of small choices: the `task next` command
returns a single object (not a paginated list); `--project` accepts
either a name or a UUID (so an agent can pass whichever it has at
hand); deletion cascades so an agent doesn't have to remember cleanup.

### 2. The model is the truth

There is no "view layer" in taskline. The kanban board, the dependency
graph, and the CLI are all derivations of the same SQLite tables. There
are no hidden flags ("archived", "snoozed", "blocked-by-other-team")
that exist in one view but not another. A single SQL query can answer
"what should I do next?" — that's the test.

### 3. Reversible state

`pending → start → spec → dev → test → review → done`. The expected motion
is forward from `start`, but the state machine permits any move between
known states. A review that surfaces a defect should drop the task
back to `dev`; work that turns out to need product clarification should
drop back to `spec`. Forcing the agent to delete-and-recreate in those cases
destroys history (description, dependencies, attachments) that is
exactly the context a future agent needs.

Skipping forward is fine too (`start → done` is a perfectly valid
move for trivial work). The state machine's only job is to keep the
set of legal state names honest; the *direction* of motion is a
modeling choice the agent gets to make.

`pending` lives off the main pipeline. It captures the difference
between "I want to work on this" and "I want to remember this". A
task in `pending` is not runnable — `task next` skips it — so a
backlog of half-formed ideas doesn't drown the queue. Promote with
`task update --state start` (or any forward state) when it's ready,
or drop a runnable task into `pending` when it should stop being a
candidate. The web modal exposes an *auto-start* toggle on create;
the CLI flag is `--auto-start` (default true).

The earlier "forward-only" rule was a guard against stalled-card
graveyards. Priority + the runnable query already prevent that: a
task that has fallen back to `dev` or `test` is still visible,
sortable, and surfaced by `task next`. The graveyard problem was never
about backward edges; it was about invisibility.

### 4. Dependencies are a DAG, not a tree

Real work has shared prerequisites. "Set up auth" might block both
"build dashboard" and "add API key UI". A tree would force you to pick
one parent and lie about the other; a DAG records the truth.

Cycle prevention is non-negotiable — a cycle would let the runnable
query lie about what's actually unblocked. Cycle detection is a DFS
per-insert. The DAG never gets large enough for that to matter.

### 5. One binary, one file

Deploying taskline is `scp dist/taskline-server somewhere && ./taskline-server`.
SQLite is one file. Image attachments are one directory of files. The
React UI is `go:embed`-ed into the binary. There is no Postgres, no
Redis, no Etcd, no message broker, no Docker Compose, no Kubernetes
manifest. The whole point is that an agent can boot taskline on a
fresh laptop in fifteen seconds.

This caps the project's ambition. We will never be a multi-tenant SaaS;
we will never have a "team workspace" feature; we will never sync
across machines. Those things are real, useful, and out of scope.

### 6. Priority is an integer, sorting is server-side

Priority is one signed integer per task. Higher means runs sooner. Ties
break on creation time (FIFO). Agents do not need to argue with a
labeling taxonomy — they pick a number, and `task next` does the rest.

This is intentionally underpowered. taskline does not model "urgency vs
importance", "estimated effort", "blocked by user feedback", or any of
the other decoration humans like to add. If you need that, derive it on
the agent side and translate to a number.

## Why these specific seven states

`pending → start → spec → dev → test → review → done` is opinionated. Other
shapes were considered:

- **Three states** (`todo / doing / done`): too coarse. Agents working
  in parallel need to know whether something is in spec (product
  requirements, UX, scope, and acceptance criteria are still malleable)
  or in dev (technical design and implementation are underway).
- **No separate `test` stage**: too easy for agents to treat "code is
  written" as "development is complete". `test` is explicit local
  verification: test review, unit tests, API e2e, browser smoke, and
  any other checks that should pass before PR review begins.
- **Custom per-project workflows**: tempting, but the agent contract
  becomes per-project, and `task next` stops being a single thing. The
  seven states cover ~all of "knowledge work that ships software"; if
  you need something else, this isn't your tool.
- **A separate "blocked" state**: redundant with the dep DAG. A task
  with an unfinished dep is *already* not returned by `task next`;
  adding a state would let the truth get out of sync with the edges.

## Non-goals

- **CI / runner orchestration.** taskline records what should happen,
  not what *is* happening. State only changes when something writes to
  the API. We don't poll, we don't trigger jobs, we don't watch git.
- **Spec authoring.** A task has a title and a description. If you want
  spec-style requirements, write them in the description or link to a
  doc. taskline tracks *that work exists*, not *what the work is*.
- **Multi-user collaboration.** No accounts, no permissions, no audit
  log. Single user, single machine. If multiple humans need to share a
  taskline, they share the database file (or stand up one instance per
  human and don't pretend it's the same workspace).
- **History / time travel.** `updated_at` is the only nod to history.
  No event log, no "show me what this task looked like yesterday". If
  this matters to you, taskline is the wrong abstraction — use Git.

## What the web UI is for

The UI is a courtesy, not the product. It exists so a human watching
the agent work has something to look at — a kanban board to see
distribution across states, a dependency graph to see structure. It
auto-refreshes every 10 seconds because the canonical mutation path is
the CLI / API; the UI is a passive observer that happens to also let
you drag cards around.

Everything the UI can do, the CLI can do. The UI cannot do anything
the CLI can't. This is by design.

## Where we'd cut, if forced

If taskline had to lose a feature tomorrow:

- **Image attachments** would go first. They're convenient (paste a
  screenshot of a bug into a task) but they couple the server to the
  filesystem and add the only multipart endpoint. A pure-JSON server
  would be simpler.
- **The web UI** would go second. It's the largest single chunk of
  code and the agent contract doesn't depend on it.
- **The kanban view** would lose to the dependency graph. The graph
  shows actual structure; the kanban is a flatter view of the same
  data with more pixels.

The CLI, the state machine, and the dep DAG are non-negotiable — those
are the product.
