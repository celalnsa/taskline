# Skill stage-action playbook

Design spec for taskline task `5604172a-eedf-4cc9-9aff-d2345ea091d7`
(*"优化skills文档对各阶段动作的引导"*).

## Goal

`skills/taskline-management/SKILL.md` currently ends with a thin
"Recommended agent loop" that just says *"call task next, update state
forward, repeat."* That's enough for trivial work and useless for real
work. Replace it with a per-stage playbook that names the concrete
actions an agent should take in each state.

## Non-goals

- Not changing the CLI surface, the API, or the state machine.
- Not introducing a new skill — this is a documentation rewrite.
- Not turning every task into a heavyweight ceremony — small fixes
  must remain small (see *Fast path* below).

## The five stages

### created → design

- **Trigger**: agent has just claimed the task (`task next`).
- **Actions**:
  1. Create a feature branch off `main`:
     `git checkout main && git pull && git checkout -b feature/<short-slug>`
  2. Confirm the working tree is clean.
- **Advance**: `taskline task update <id> --state design`
- **Skip when**: trivial single-file fix with no behavior change — see
  *Fast path*.

### design → dev

- **Trigger**: branch exists, task title + description are loaded.
- **Actions**:
  1. Brainstorming pass — auto-mode (no human checkpoints).
     Capability: explore intent, list 2-3 approaches, pick one.
     If available: `superpowers:brainstorming`.
  2. Plan pass — break the chosen approach into ordered steps and
     identify the test strategy. If available:
     `superpowers:writing-plans`.
  3. Capture the chosen approach in a short note (commit message body
     or a one-paragraph spec) so the dev phase has a contract.
- **Advance**: `taskline task update <id> --state dev`
- **Skip when**: change is mechanical (rename, formatting, single-line
  config) — go straight to dev.

### dev → review

- **Trigger**: design note in hand.
- **Actions** (test-first):
  1. Write or extend failing tests for the new behavior.
  2. Implement the code until tests pass.
  3. Run the full project test suite (`go test ./...` per module,
     `pnpm build` for the web). Lint/format as the project requires.
  4. Stage and commit. Conventional, minimal commit messages.
- **Advance**: `taskline task update <id> --state review`
- **Skip when**: never. Tests are the gate, not the ceremony.

### review → done

- **Trigger**: implementation committed on the feature branch.
- **Actions**:
  1. Self code-review — capability: spot bugs, dead code,
     boundary issues. If available: `code-review:code-review`.
  2. Fix anything the review surfaces; re-run tests after each fix.
  3. Push the branch: `git push -u origin <branch>`.
  4. Open a PR: `gh pr create` with title + summary + test plan.
  5. Wait for CI to settle. If CI fails, fix root cause locally,
     re-run tests, push.
  6. Read PR comments (`gh api repos/.../pulls/<n>/comments`).
     Address each one; re-run tests after each batch of fixes;
     push.
- **Advance**: `taskline task update <id> --state done` *only after*
  CI is green and comments are addressed.
- **Drop back to dev** when: the review or CI surfaces a real defect
  (the bidirectional state machine is for exactly this).

### done — wrap-up

- **Trigger**: PR is approved + CI green.
- **Actions**:
  1. `gh pr merge --squash` (or merge style the repo conventionally
     uses).
  2. `git checkout main && git pull`.
  3. Delete the local feature branch.
- The task is already `done` in taskline; this stage is repo hygiene.

## Fast path (trivial work)

A task qualifies as fast-path when **all** of:

- single file changed,
- no behavior change visible to other code,
- no test scaffolding or new dependency.

Examples: typo fix in a comment, raising a log level, bumping a
constant. For fast-path tasks the loop collapses to:

```
created → dev → done
```

No branch, no design note, no PR. Commit directly on main with a
one-line message. The state machine still records what happened.

## Why these specific shapes

- **Each stage has a single literal advance command.** Agents shouldn't
  have to guess; the prescription is one line. Higher-order skills
  (brainstorming, code-review) get a capability + skill-name pointer
  so harnesses without Superpowers degrade gracefully.
- **Bidirectional state is honored explicitly.** Review → dev is
  called out as the supported drop-back. This is the reason backward
  transitions were added in the previous task — the playbook proves
  the workflow needs them.
- **Fast path is documented, not hidden.** Without an explicit escape
  hatch, agents over-ceremonialize one-line fixes. With one, the heavy
  loop stays heavy and the light loop stays light.
- **Tests are the only non-skippable stage gate.** Everything else has
  a "skip when" clause; dev does not. This matches the project's stated
  conviction that the model is the truth.

## Self-review notes

- No TBDs, no placeholders.
- "Skip when" clauses for created and design are consistent with the
  fast-path section (single-file, no behavior change).
- Skill name format `<capability> (e.g. <skill> if available)` is
  uniform.
- Scope: single SKILL.md edit. No follow-on work.
