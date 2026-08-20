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
#   3. Selected skills retain required workflow rules and reject obsolete
#      rules. These semantic smoke checks intentionally use regexes rather
#      than pinning the whole document verbatim.
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
        "### dev → test",
        "### test → review",
        "### review → done",
        "## Fast path",
    ],
    ".agents/skills/taskline-localtest/SKILL.md": [
        "### 1. Write the test FIRST",
        "### 2. Rebuild AND restart the running server",
        "### 3. Run the FULL test on the restarted binary",
    ],
}

# Named rules make failures actionable and double as small policy fixtures for
# the PR scenarios the public taskline skill must handle. Patterns use DOTALL
# where a rule may be wrapped across Markdown lines.
required_rules = {
    "skills/taskline-management/SKILL.md": [
        ("latest-head settle window",
         r"10-minute review settle window.*latest PR head"),
        ("required CI and settle window run together",
         r"required CI.*concurrently.*10-minute review settle window"),
        ("new push resets settle window",
         r"new push.*fresh 10-minute review settle window.*new head"),
        ("no review before window remains blocked",
         r"no review.*settle window.*has not ended.*must not merge"),
        ("no review after window may proceed",
         r"settle window.*ended.*no review.*not a blocker"),
        ("refresh every GitHub evidence surface",
         r"refresh.*required checks.*review summaries.*review threads.*top-level PR comments"),
        ("merge uses the server-compatible aggregate rollup",
         r"full `statusCheckRollup`.*SUCCESS.*empty.*before merge"),
        ("review evidence queries paginate",
         r"gh api --paginate repos/<owner>/<repo>/pulls/<n>/reviews.*gh api --paginate repos/<owner>/<repo>/pulls/<n>/comments.*gh api --paginate repos/<owner>/<repo>/issues/<n>/comments.*gh api graphql --paginate"),
        ("repository automatic review is the default",
         r"repository-configured automatic review.*Do not run a local review-agent command.*manually summon a review bot"),
        ("P0 and P1 findings block",
         r"P0/P1.*fix.*reasoned rebuttal.*resolve.*thread"),
        ("P2 and P3 threads may be resolved without reply",
         r"P2/P3.*do not require.*code change.*reply.*resolve.*thread"),
        ("unprioritized human findings block",
         r"unprioritized human.*fix.*reasoned rebuttal"),
        ("ordinary review fixes stay in review",
         r"Ordinary review fixes.*stay in `review`"),
        ("material design changes return to dev",
         r"material.*product scope.*architecture.*solution.*return.*`dev`"),
        ("stage docs use batched local copies",
         r"local working cop.*taskline task doc update.*logical batch"),
        ("architecture subagent is conditional",
         r"architecture subagent.*only.*cross-module.*genuine.*alternatives"),
    ],
}

prohibited_rules = {
    "skills/taskline-management/SKILL.md": [
        ("mandatory posted review", r"Wait for at least one review"),
        ("local codex review command", r"\bcodex\s+review\b"),
        ("manual codex mention", r"@codex\b"),
        ("default architecture subagent",
         r"Prefer a separate architect-style subagent when your harness supports subagents"),
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

    flags = re.IGNORECASE | re.DOTALL
    normalized_body = re.sub(r"\s+", " ", body)
    missing_rules = [name for name, pattern in required_rules.get(path, [])
                     if re.search(pattern, normalized_body, flags) is None]
    if missing_rules:
        print(f"FAIL: {path} missing workflow rules: "
              + ", ".join(missing_rules))
        failed = True

    obsolete_rules = [name for name, pattern in prohibited_rules.get(path, [])
                      if re.search(pattern, normalized_body, flags) is not None]
    if obsolete_rules:
        print(f"FAIL: {path} contains obsolete workflow rules: "
              + ", ".join(obsolete_rules))
        failed = True

    if missing_rules or obsolete_rules:
        continue

    print(f"ok: {path}")

if failed:
    sys.exit(1)
PY
