# Skill stage-action playbook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the thin "Recommended agent loop" section in `skills/taskline-management/SKILL.md` with a five-stage playbook plus a fast-path escape hatch, per the spec at `docs/superpowers/specs/2026-05-06-skill-stage-actions-design.md`.

**Architecture:** Single Markdown file edit. TDD via a small shell-driven smoke test that (1) verifies the YAML frontmatter still parses and (2) asserts each of the five stage subsection headers and the fast-path callout are present. The test lives at `scripts/test-skill.sh` — outside the skill directory, since the skill itself is symlinked into other projects and shouldn't ship a test runner.

**Tech Stack:** Markdown + a Bash + Python3 smoke test (Python is on every macOS/Linux dev box; PyYAML is in the standard distribution path via `pip install pyyaml`, but the test uses only `re` + `tomllib`-free parsing — no external deps needed).

---

## File Structure

- `scripts/test-skill.sh` — new smoke test, executable. Project-level tooling, sibling to `build.sh` and `install-local.sh`.
- `skills/taskline-management/SKILL.md` — modified: agent-loop section replaced.

Files that change together stay together: the SKILL is one unit, test next to it.

---

### Task 1: Smoke test that fails today

**Files:**
- Create: `scripts/test-skill.sh`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-skill.sh`:

```bash
#!/usr/bin/env bash
# Smoke test for skills/taskline-management/SKILL.md.
# Exits non-zero if the frontmatter is malformed or any required
# stage section is missing. Has zero non-stdlib dependencies.
set -euo pipefail

cd "$(dirname "$0")"

python3 - <<'PY'
import re, sys

with open("SKILL.md", encoding="utf-8") as f:
    content = f.read()

m = re.match(r"^---\n(.*?)\n---\n(.*)", content, re.DOTALL)
if not m:
    sys.exit("FAIL: SKILL.md has no YAML frontmatter")

fm_block, body = m.group(1), m.group(2)

# Cheap YAML sanity check — every non-blank, non-indented line must be
# 'key: value' or 'key:' (block scalar). We don't need a real parser to
# catch the common breakage modes (unbalanced quotes, missing colons).
for ln in fm_block.splitlines():
    if not ln.strip() or ln.startswith(" ") or ln.startswith("\t"):
        continue
    if ":" not in ln:
        sys.exit(f"FAIL: frontmatter line missing colon: {ln!r}")

required = [
    "### created → design",
    "### design → dev",
    "### dev → review",
    "### review → done",
    "## Fast path",
]
missing = [r for r in required if r not in body]
if missing:
    sys.exit("FAIL: missing sections: " + ", ".join(missing))

print("ok")
PY
```

Then make it executable:

```bash
chmod +x scripts/test-skill.sh
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `./scripts/test-skill.sh`
Expected: exit 1 with `FAIL: missing sections: ### created → design, ### design → dev, ### dev → review, ### review → done, ## Fast path`

(SKILL.md doesn't have those headers yet — that's the point.)

- [ ] **Step 3: Commit the test**

```bash
git add scripts/test-skill.sh
git commit -m "test: smoke check for SKILL.md stage sections"
```

---

### Task 2: Rewrite SKILL.md

**Files:**
- Modify: `skills/taskline-management/SKILL.md` — replace the `## Recommended agent loop` section with a `## Stage playbook` section and append a `## Fast path` section before "What this skill is not".

- [ ] **Step 1: Replace the agent-loop section**

Find this block in `SKILL.md`:

```markdown
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
```

Replace it with:

````markdown
## Stage playbook

When asked to "work the queue":

1. `taskline task next --project <p> --format json` — get a single task.
2. If `task` is `null`, report there's nothing runnable and stop.
3. Read `title` + `description` (and `images` if present — server
   stores them under `$TASKLINE_IMAGES_DIR/<task-id>/`).
4. Walk the task through the stages below. Each stage describes the
   actions, the literal command to advance, and when the stage may be
   skipped.
5. Loop back to step 1.

Each stage has the same shape: **Trigger** (what just happened) →
**Actions** → **Advance** (literal CLI command) → **Skip when**
(escape clause). Higher-order skills are referenced by capability,
with a Superpowers skill name in parentheses for harnesses that have
them — drop the parenthetical if the skill isn't installed.

### created → design

- **Trigger:** the agent has just claimed the task.
- **Actions:**
  1. `git checkout main && git pull`
  2. `git checkout -b feature/<short-slug>` (slug derived from the
     task title — keep it short, kebab-case).
  3. Confirm the working tree is clean.
- **Advance:** `taskline task update <id> --state design`
- **Skip when:** the change qualifies as fast-path (see below).

### design → dev

- **Trigger:** branch exists, task title + description are loaded.
- **Actions:**
  1. Brainstorm the approach — explore intent, list 2-3 options, pick
     one. Auto-mode (no human checkpoint).
     Capability: brainstorming (e.g. `superpowers:brainstorming` if
     available).
  2. Plan the work — break the chosen approach into ordered steps and
     identify the test strategy.
     Capability: plan writing (e.g. `superpowers:writing-plans` if
     available).
  3. Capture the decision in a short note (commit body or one-paragraph
     spec) so the dev phase has a contract.
- **Advance:** `taskline task update <id> --state dev`
- **Skip when:** the change is mechanical (rename, formatting,
  single-line config) — go straight to dev.

### dev → review

- **Trigger:** design note in hand.
- **Actions** (test-first):
  1. Write or extend failing tests for the new behavior.
  2. Implement until the tests pass.
  3. Run the full project test suite for whatever you touched
     (e.g. `( cd server && go test ./... )`, `( cd cli && go test ./... )`,
     `( cd web && pnpm build )`). Lint/format as the project requires.
  4. Stage and commit. Conventional, minimal commit messages.
- **Advance:** `taskline task update <id> --state review`
- **Skip when:** never. Tests are the gate, not the ceremony.

### review → done

- **Trigger:** implementation committed on the feature branch.
- **Actions:**
  1. Self code-review — spot bugs, dead code, boundary issues.
     Capability: code review (e.g. `code-review:code-review` if
     available).
  2. Fix anything the review surfaces; re-run tests after each fix.
  3. Push the branch: `git push -u origin <branch>`.
  4. Open a PR: `gh pr create` with title, summary, and a test plan.
  5. Wait for CI. If it fails, fix the root cause locally, re-run
     tests, push.
  6. Read PR comments
     (`gh api repos/<owner>/<repo>/pulls/<n>/comments`).
     Address each one; re-run tests after each batch of fixes; push.
- **Advance:** `taskline task update <id> --state done` *only after*
  CI is green and review comments are addressed.
- **Drop back to dev** when the review or CI surfaces a real defect.
  The bidirectional state machine exists for exactly this — don't
  delete-and-recreate.

### done — wrap-up

- **Trigger:** PR approved + CI green.
- **Actions:**
  1. `gh pr merge --squash` (or the project's conventional style).
  2. `git checkout main && git pull`
  3. Delete the local feature branch.
- The taskline task is already `done`; this stage is repo hygiene.

## Fast path

A task qualifies as fast-path when **all** of:

- single file changed,
- no behavior change visible to other code,
- no test scaffolding or new dependency.

Examples: typo fix in a comment, raising a log level, bumping a
constant. The loop collapses to:

```
created → dev → done
```

No branch, no design note, no PR. Commit directly on main with a
one-line message. The state machine still records what happened.
````

- [ ] **Step 2: Run the smoke test, confirm it passes**

Run: `./scripts/test-skill.sh`
Expected: prints `ok` and exits 0.

- [ ] **Step 3: Commit the doc change**

```bash
git add skills/taskline-management/SKILL.md
git commit -m "docs(skill): replace thin agent loop with stage playbook"
```

---

## Self-review

- **Spec coverage:** every section of the spec maps to a section in
  the new SKILL content (created/design/dev/review/done + fast path).
- **Placeholder scan:** none. Each section has concrete commands and
  text. No "TBD" / "TODO".
- **Type / name consistency:** `superpowers:brainstorming` and
  `superpowers:writing-plans` are written identically in spec and
  plan; `code-review:code-review` matches the actual installed skill.
- **Scope:** one Markdown file + one shell test, single PR. No
  follow-on work.
