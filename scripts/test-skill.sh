#!/usr/bin/env bash
# Smoke tests for every SKILL.md under skills/.
# Lives outside the skill dirs on purpose — each skill is symlinked
# into ~/.agents/skills/ and ~/.claude/skills/ by install-local.sh,
# and shipping a test runner along with them would clutter every
# harness that imports the skills.
#
# Per skill, this checks:
#   1. The YAML frontmatter is present and parses (cheap shape check,
#      no PyYAML dependency).
#   2. A small allowlist of required sections is present in the body
#      so a structural rewrite can't silently drop them.
#
# Has zero non-stdlib dependencies (python3 only).
set -euo pipefail

cd "$(dirname "$0")/.."

python3 - <<'PY'
import re, sys

# Per-skill required sections. Add new entries here when a new skill
# lands under skills/. Sections are matched by exact substring on the
# body (so heading hashes and exact wording are part of the contract).
required_sections = {
    "skills/taskline-management/SKILL.md": [
        "### created → design",
        "### design → dev",
        "### dev → review",
        "### review → done",
        "## Fast path",
    ],
    "skills/taskline-localtest/SKILL.md": [
        "### 1. Write the test FIRST",
        "### 2. Rebuild AND restart the running server",
        "### 3. Run the FULL test on the restarted binary",
    ],
}

failed = False
for path, required in required_sections.items():
    with open(path, encoding="utf-8") as f:
        content = f.read()

    m = re.match(r"^---\n(.*?)\n---\n(.*)", content, re.DOTALL)
    if not m:
        print(f"FAIL: {path} has no YAML frontmatter")
        failed = True
        continue
    fm_block, body = m.group(1), m.group(2)

    # Cheap YAML sanity: every non-blank, non-indented line must contain
    # a colon. Catches unbalanced quotes / missing colons without pulling
    # in PyYAML.
    fm_ok = True
    for ln in fm_block.splitlines():
        if not ln.strip() or ln.startswith(" ") or ln.startswith("\t"):
            continue
        if ":" not in ln:
            print(f"FAIL: {path} frontmatter line missing colon: {ln!r}")
            fm_ok = False
            failed = True
    if not fm_ok:
        continue

    missing = [r for r in required if r not in body]
    if missing:
        print(f"FAIL: {path} missing sections: " + ", ".join(missing))
        failed = True
        continue

    print(f"ok: {path}")

if failed:
    sys.exit(1)
PY
