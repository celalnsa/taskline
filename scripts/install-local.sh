#!/usr/bin/env bash
# scripts/install-local.sh — install taskline CLI for the current user.
#
#   1. builds the CLI (no CGO, no web bundle) into ~/.local/bin/taskline
#   2. symlinks every skill under skills/ into the well-known agent
#      skill directories so any harness picks them up:
#        ~/.agents/skills/<name>
#        ~/.claude/skills/<name>
#
# Re-running is safe: existing symlinks at targets are replaced; a real
# directory at a target aborts the script (we don't clobber user data).
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

BIN_DIR="${HOME}/.local/bin"
# Auto-discover every directory under skills/ so dropping a new
# skill in the repo doesn't require editing this script.
SKILLS=()
for d in "${REPO_ROOT}/skills"/*/; do
    [[ -d "${d}" ]] || continue
    SKILLS+=("$(basename "${d}")")
done
SKILL_HARNESS_DIRS=(
    "${HOME}/.agents/skills"
    "${HOME}/.claude/skills"
)

echo "[install] building CLI → ${BIN_DIR}/taskline" >&2
mkdir -p "${BIN_DIR}"
( cd cli && go build -o "${BIN_DIR}/taskline" . )

link_skill() {
    local name="$1"
    local harness_dir="$2"
    local src="${REPO_ROOT}/skills/${name}"
    local target="${harness_dir}/${name}"
    mkdir -p "${harness_dir}"
    if [[ -L "${target}" ]]; then
        rm "${target}"
    elif [[ -e "${target}" ]]; then
        echo "[install] refusing to overwrite non-symlink: ${target}" >&2
        exit 1
    fi
    ln -s "${src}" "${target}"
    echo "[install] linked ${target} → ${src}" >&2
}

for skill in "${SKILLS[@]}"; do
    for dir in "${SKILL_HARNESS_DIRS[@]}"; do
        link_skill "${skill}" "${dir}"
    done
done

echo "[install] done." >&2
echo >&2
case ":${PATH}:" in
    *":${BIN_DIR}:"*) ;;
    *) echo "[install] note: ${BIN_DIR} is not on \$PATH — add it to your shell rc." >&2 ;;
esac
