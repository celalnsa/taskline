#!/usr/bin/env bash
# Smoke tests for every SKILL.md under both skill trays:
#   - skills/<name>/SKILL.md         — public skills (exported globally)
#   - .agents/skills/<name>/SKILL.md — project-internal skills
#
# Lives outside the skill dirs on purpose — public skills are
# symlinked into ~/.agents/skills/ and ~/.claude/skills/ by
# install-local.sh, and shipping a test runner along with them
# would clutter every harness that imports the skills.
#
# For every SKILL.md found, this checks:
#   1. The YAML frontmatter is present and parses (cheap shape check,
#      no PyYAML dependency, comments tolerated).
#   2. If the skill has an entry in `required_sections`, every listed
#      section is present in the body — guards against structural
#      rewrites silently dropping load-bearing headings.
#
# Has zero non-stdlib dependencies (python3 only).
set -euo pipefail

cd "$(dirname "$0")/.."

python3 - <<'PY'
import glob, re, sys

# Per-skill required sections, keyed by repo-relative SKILL.md path.
# Optional — skills not listed here only get the baseline frontmatter
# shape check. Sections are matched by exact substring on the body
# (so heading hashes and exact wording are part of the contract).
required_sections = {
    "skills/taskline-management/SKILL.md": [
        "### start → spec",
        "### spec → dev",
        "### dev → review",
        "### review → done",
        "## Fast path",
    ],
    ".agents/skills/taskline-localtest/SKILL.md": [
        "### 1. Write the test FIRST",
        "### 2. Rebuild AND restart the running server",
        "### 3. Run the FULL test on the restarted binary",
    ],
}

paths = sorted(glob.glob("skills/*/SKILL.md")
               + glob.glob(".agents/skills/*/SKILL.md"))
if not paths:
    sys.exit("FAIL: no SKILL.md files found under skills/ or .agents/skills/")

failed = False
for path in paths:
    with open(path, encoding="utf-8") as f:
        content = f.read()

    m = re.match(r"^---\n(.*?)\n---\n(.*)", content, re.DOTALL)
    if not m:
        print(f"FAIL: {path} has no YAML frontmatter")
        failed = True
        continue
    fm_block, body = m.group(1), m.group(2)

    # Cheap YAML sanity: every non-blank, non-indented, non-comment
    # line must contain a colon. Catches unbalanced quotes / missing
    # colons without pulling in PyYAML.
    fm_ok = True
    for ln in fm_block.splitlines():
        if not ln.strip() or ln.startswith((" ", "\t", "#")):
            continue
        if ":" not in ln:
            print(f"FAIL: {path} frontmatter line missing colon: {ln!r}")
            fm_ok = False
            failed = True
    if not fm_ok:
        continue

    required = required_sections.get(path, [])
    missing = [r for r in required if r not in body]
    if missing:
        print(f"FAIL: {path} missing sections: " + ", ".join(missing))
        failed = True
        continue

    print(f"ok: {path}")

if failed:
    sys.exit(1)
PY
