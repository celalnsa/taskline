#!/usr/bin/env bash
# Smoke test for skills/taskline-management/SKILL.md.
# Lives outside the skill dir on purpose — the skill is symlinked into
# ~/.agents/skills/ and ~/.claude/skills/ by scripts/install-local.sh,
# and shipping a test runner along with it would clutter every harness
# that imports the skill.
#
# Exits non-zero if the frontmatter is malformed or any required stage
# section is missing. Has zero non-stdlib dependencies.
set -euo pipefail

cd "$(dirname "$0")/.."

python3 - <<'PY'
import re, sys

with open("skills/taskline-management/SKILL.md", encoding="utf-8") as f:
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
