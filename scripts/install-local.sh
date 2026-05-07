#!/usr/bin/env bash
# scripts/install-local.sh — install taskline CLI for the current user.
#
#   1. builds the CLI (no CGO, no web bundle) into ~/.local/bin/taskline
#   2. symlinks each skill under skills/ (the "public" tray, exported
#      to other projects) into the well-known agent skill directories
#      so any harness picks it up:
#        ~/.agents/skills/<name>
#        ~/.claude/skills/<name>
#   3. prunes any global symlink that previously pointed into this
#      repo's skills/ but whose target no longer exists — so moving a
#      skill from skills/ to .agents/skills/ (the project-internal
#      tray) cleans up its global presence on the next run.
#
# Project-internal skills live under .agents/skills/<name>/ and are
# *deliberately not* installed globally — harnesses pick them up by
# auto-discovering when the project is the working directory. Their
# SKILL.md frontmatter also carries `internal: true` so any tool that
# parses the file knows the same thing without scanning the path.
#
# As a safety net, if a skill is found under skills/ AND has
# `internal: true` in frontmatter (i.e. authoring slip), it's
# silently treated like a .agents/skills/ skill — skipped from the
# global install and any pre-existing global symlink for it removed.
#
# Re-running is safe: existing symlinks at targets are replaced; a real
# directory at a target aborts the script (we don't clobber user data).
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

BIN_DIR="${HOME}/.local/bin"
# Auto-discover every directory under skills/ (public tray) so
# dropping a new skill in the repo doesn't require editing this
# script. Internal skills live under .agents/skills/ and are not
# discovered here.
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

unlink_internal_skill() {
    local name="$1"
    local harness_dir="$2"
    local target="${harness_dir}/${name}"
    if [[ -L "${target}" ]]; then
        rm "${target}"
        echo "[install] cleaned up internal-flagged symlink ${target}" >&2
    fi
}

# Frontmatter probe: returns 0 when the skill's SKILL.md declares
# `internal: true`. Comments-and-blank-line tolerant; only inspects
# the first --- ... --- block.
is_internal_skill() {
    local skill_dir="${REPO_ROOT}/skills/$1"
    local md="${skill_dir}/SKILL.md"
    [[ -f "${md}" ]] || return 1
    awk '
        /^---$/ { fm++; next }
        fm == 1 && /^[[:space:]]*internal:[[:space:]]*true[[:space:]]*$/ { print "yes"; exit }
        fm == 2 { exit }
    ' "${md}" | grep -q yes
}

# Walk each harness skill dir; for any symlink whose target points
# into THIS repo's skills/ but no longer resolves (skill removed or
# moved to .agents/skills/), remove the symlink. We deliberately
# only touch links that pointed at our own repo so we never delete
# someone else's installs.
prune_dangling_symlinks() {
    local harness_dir="$1"
    [[ -d "${harness_dir}" ]] || return 0
    local link target
    for link in "${harness_dir}"/*; do
        [[ -L "${link}" ]] || continue
        target=$(readlink "${link}")
        if [[ "${target}" == "${REPO_ROOT}/skills/"* ]] && [[ ! -e "${target}" ]]; then
            rm "${link}"
            echo "[install] pruned dangling symlink ${link} → ${target}" >&2
        fi
    done
}

for skill in "${SKILLS[@]}"; do
    if is_internal_skill "${skill}"; then
        echo "[install] ${skill} marked internal — skipping global install" >&2
        for dir in "${SKILL_HARNESS_DIRS[@]}"; do
            unlink_internal_skill "${skill}" "${dir}"
        done
        continue
    fi
    for dir in "${SKILL_HARNESS_DIRS[@]}"; do
        link_skill "${skill}" "${dir}"
    done
done

for dir in "${SKILL_HARNESS_DIRS[@]}"; do
    prune_dangling_symlinks "${dir}"
done

echo "[install] done." >&2
echo >&2
case ":${PATH}:" in
    *":${BIN_DIR}:"*) ;;
    *) echo "[install] note: ${BIN_DIR} is not on \$PATH — add it to your shell rc." >&2 ;;
esac
