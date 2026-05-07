#!/usr/bin/env bash
# scripts/install-local.sh — install taskline CLI for the current user.
#
#   1. builds the CLI (no CGO, no web bundle) into ~/.local/bin/taskline
#   2. symlinks skills/taskline-management/ into the well-known skill
#      directories so any agent harness picks it up:
#        ~/.agents/skills/taskline-management
#        ~/.claude/skills/taskline-management
#
# Re-running is safe: existing symlinks at the targets are replaced; a real
# directory at a target aborts the script (we don't clobber user data).
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

BIN_DIR="${HOME}/.local/bin"
SKILL_SRC="${REPO_ROOT}/skills/taskline-management"
SKILL_TARGETS=(
    "${HOME}/.agents/skills/taskline-management"
    "${HOME}/.claude/skills/taskline-management"
)

echo "[install] building CLI → ${BIN_DIR}/taskline" >&2
mkdir -p "${BIN_DIR}"
( cd cli && go build -o "${BIN_DIR}/taskline" . )

link_skill() {
    local target="$1"
    mkdir -p "$(dirname "${target}")"
    if [[ -L "${target}" ]]; then
        rm "${target}"
    elif [[ -e "${target}" ]]; then
        echo "[install] refusing to overwrite non-symlink: ${target}" >&2
        exit 1
    fi
    ln -s "${SKILL_SRC}" "${target}"
    echo "[install] linked ${target} → ${SKILL_SRC}" >&2
}

for t in "${SKILL_TARGETS[@]}"; do
    link_skill "${t}"
done

echo "[install] done." >&2
echo >&2
case ":${PATH}:" in
    *":${BIN_DIR}:"*) ;;
    *) echo "[install] note: ${BIN_DIR} is not on \$PATH — add it to your shell rc." >&2 ;;
esac
