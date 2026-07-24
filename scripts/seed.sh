#!/usr/bin/env bash
# Create a deterministic demo project through the public taskline CLI.
set -euo pipefail

usage() {
    echo "usage: $0 [project-name]"
}

if (( $# > 1 )); then
    usage >&2
    exit 2
fi
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
project_name="${1:-taskline-demo}"
server_url="${TASKLINE_SERVER:-http://127.0.0.1:8787}"

if [[ -n "${TASKLINE_BIN:-}" ]]; then
    taskline_bin="$TASKLINE_BIN"
elif [[ -x "$repo_root/dist/taskline" ]]; then
    taskline_bin="$repo_root/dist/taskline"
elif command -v taskline >/dev/null 2>&1; then
    taskline_bin="$(command -v taskline)"
else
    echo "error: taskline CLI not found; run 'make build MODULE=cli' or set TASKLINE_BIN" >&2
    exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "error: python3 is required to parse CLI JSON" >&2
    exit 2
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/taskline-seed.XXXXXX")"
project_created=0
created_tasks=""

cleanup() {
    status=$?
    if (( status != 0 && project_created == 1 )); then
        echo "error: seed failed after creating partial project '$project_name' ($project_id)" >&2
        echo "error: created tasks: ${created_tasks:-none}" >&2
        echo "error: use a fresh project name or an isolated server before retrying" >&2
    fi
    python3 - "$tmp_dir" <<'PY'
import shutil
import sys

shutil.rmtree(sys.argv[1], ignore_errors=True)
PY
    exit "$status"
}
trap cleanup EXIT

json_id() {
    python3 -c 'import json, sys; print(json.load(sys.stdin)["id"])' < "$1"
}

echo "[seed] server=$server_url project=$project_name" >&2

"$taskline_bin" status --format json > "$tmp_dir/status.json"
"$taskline_bin" project list --format json > "$tmp_dir/projects.json"
if python3 - "$project_name" "$tmp_dir/projects.json" <<'PY'
import json
import sys

name = sys.argv[1]
with open(sys.argv[2], encoding="utf-8") as source:
    projects = json.load(source).get("projects") or []
raise SystemExit(0 if any(project["name"] == name for project in projects) else 1)
PY
then
    echo "error: project '$project_name' already exists; refusing to add duplicate seed data" >&2
    exit 2
fi

"$taskline_bin" project create \
    --name "$project_name" \
    --description "Deterministic Taskline demo for Kanban, graph, and browser tests" \
    --format json > "$tmp_dir/project.json"
project_id="$(json_id "$tmp_dir/project.json")"
project_created=1

create_task() {
    key="$1"
    target_state="$2"
    title="$3"
    description="$4"
    task_type="$5"
    priority="$6"
    shift 6

    args=(
        task create
        --project "$project_id"
        --title "$title"
        --description "$description"
        --type "$task_type"
        --priority "$priority"
    )
    if [[ "$target_state" == "pending" ]]; then
        args+=(--auto-start=false)
    fi
    for label in "$@"; do
        args+=(--label "$label")
    done

    "$taskline_bin" "${args[@]}" --format json > "$tmp_dir/task-$key.json"
    LAST_TASK_ID="$(json_id "$tmp_dir/task-$key.json")"
    if [[ -n "$created_tasks" ]]; then
        created_tasks="$created_tasks, "
    fi
    created_tasks="$created_tasks$key=$LAST_TASK_ID"

    if [[ "$target_state" != "pending" && "$target_state" != "start" ]]; then
        "$taskline_bin" task update "$LAST_TASK_ID" \
            --state "$target_state" \
            --if-state start \
            --force \
            --format json > "$tmp_dir/state-$key.json"
    fi
    echo "[seed] task $key -> $target_state" >&2
}

add_dependency() {
    key="$1"
    task_id="$2"
    dependency_key="$3"
    dependency_id="$4"
    "$taskline_bin" task depend "$task_id" \
        --on "$dependency_id" \
        --format json > "$tmp_dir/dependency-$key-$dependency_key.json"
    echo "[seed] dependency $key -> $dependency_key" >&2
}

create_task \
    mobile_notifications pending \
    "Explore mobile notifications" \
    "Evaluate whether mobile notifications belong in the next product cycle." \
    feature 20 idea mobile
mobile_notifications_id="$LAST_TASK_ID"

create_task \
    onboarding_metrics start \
    "Define onboarding success metrics" \
    "Choose measurable activation and completion signals for the onboarding flow." \
    docs 90 product metrics
onboarding_metrics_id="$LAST_TASK_ID"

create_task \
    invitation_flow spec \
    "Design workspace invitation flow" \
    "Specify invite creation, acceptance, expiry, and error-state behavior." \
    feature 80 product ux
invitation_flow_id="$LAST_TASK_ID"

create_task \
    role_access dev \
    "Implement role-based access control" \
    "Enforce workspace roles across task mutation and project administration." \
    feature 75 backend security
role_access_id="$LAST_TASK_ID"

create_task \
    onboarding_checklist dev \
    "Build onboarding checklist" \
    "Render a progress checklist that guides new members through workspace setup." \
    feature 70 frontend onboarding
onboarding_checklist_id="$LAST_TASK_ID"

create_task \
    invitation_edge_cases test \
    "Verify invitation edge cases" \
    "Cover expired links, duplicate acceptance, revoked invites, and reconnects." \
    bug 85 qa reliability
invitation_edge_cases_id="$LAST_TASK_ID"

create_task \
    keyboard_navigation start \
    "Add keyboard navigation" \
    "Support predictable focus movement and task actions without a pointer." \
    feature 65 frontend accessibility
keyboard_navigation_id="$LAST_TASK_ID"

create_task \
    rollout_plan spec \
    "Document rollout and support plan" \
    "Define release stages, support ownership, and rollback communication." \
    docs 55 docs operations
rollout_plan_id="$LAST_TASK_ID"

add_dependency role_access "$role_access_id" invitation_flow "$invitation_flow_id"
add_dependency onboarding_checklist "$onboarding_checklist_id" onboarding_metrics "$onboarding_metrics_id"
add_dependency onboarding_checklist "$onboarding_checklist_id" invitation_flow "$invitation_flow_id"
add_dependency invitation_edge_cases "$invitation_edge_cases_id" role_access "$role_access_id"
add_dependency invitation_edge_cases "$invitation_edge_cases_id" onboarding_checklist "$onboarding_checklist_id"
add_dependency keyboard_navigation "$keyboard_navigation_id" onboarding_checklist "$onboarding_checklist_id"
add_dependency rollout_plan "$rollout_plan_id" invitation_edge_cases "$invitation_edge_cases_id"

python3 - \
    "$server_url" \
    "$project_name" \
    "$project_id" \
    "$mobile_notifications_id" \
    "$onboarding_metrics_id" \
    "$invitation_flow_id" \
    "$role_access_id" \
    "$onboarding_checklist_id" \
    "$invitation_edge_cases_id" \
    "$keyboard_navigation_id" \
    "$rollout_plan_id" > "$tmp_dir/manifest.json" <<'PY'
import json
import sys

(
    server,
    project_name,
    project_id,
    mobile_notifications,
    onboarding_metrics,
    invitation_flow,
    role_access,
    onboarding_checklist,
    invitation_edge_cases,
    keyboard_navigation,
    rollout_plan,
) = sys.argv[1:]

manifest = {
    "schema_version": 1,
    "server": server,
    "project": {"id": project_id, "name": project_name},
    "tasks": {
        "mobile_notifications": {"id": mobile_notifications, "state": "pending"},
        "onboarding_metrics": {"id": onboarding_metrics, "state": "start"},
        "invitation_flow": {"id": invitation_flow, "state": "spec"},
        "role_access": {"id": role_access, "state": "dev"},
        "onboarding_checklist": {"id": onboarding_checklist, "state": "dev"},
        "invitation_edge_cases": {"id": invitation_edge_cases, "state": "test"},
        "keyboard_navigation": {"id": keyboard_navigation, "state": "start"},
        "rollout_plan": {"id": rollout_plan, "state": "spec"},
    },
    "edges": [
        ["role_access", "invitation_flow"],
        ["onboarding_checklist", "onboarding_metrics"],
        ["onboarding_checklist", "invitation_flow"],
        ["invitation_edge_cases", "role_access"],
        ["invitation_edge_cases", "onboarding_checklist"],
        ["keyboard_navigation", "onboarding_checklist"],
        ["rollout_plan", "invitation_edge_cases"],
    ],
}

json.dump(manifest, sys.stdout, indent=2)
sys.stdout.write("\n")
PY

echo "[seed] created 8 tasks and 7 dependency edges" >&2
cat "$tmp_dir/manifest.json"
