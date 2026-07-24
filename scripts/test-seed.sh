#!/usr/bin/env bash
# Integration and failure-contract tests for scripts/seed.sh.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
server_bin="$repo_root/dist/taskline-server"
taskline_bin="$repo_root/dist/taskline"

if [[ ! -x "$server_bin" || ! -x "$taskline_bin" ]]; then
    echo "error: seed test requires dist binaries; run 'make build' first" >&2
    exit 2
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/taskline-seed-test.XXXXXX")"
server_pid=""

cleanup() {
    if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
        kill "$server_pid" 2>/dev/null || true
        wait "$server_pid" 2>/dev/null || true
    fi
    python3 - "$tmp_dir" <<'PY'
import shutil
import sys

shutil.rmtree(sys.argv[1], ignore_errors=True)
PY
}
trap cleanup EXIT

port="$(python3 - <<'PY'
import socket

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
)"
server_url="http://127.0.0.1:$port"

TASKLINE_DB="$tmp_dir/taskline.db" \
TASKLINE_IMAGES_DIR="$tmp_dir/images" \
TASKLINE_DOCS_DIR="$tmp_dir/docs" \
TASKLINE_LISTEN="0.0.0.0:$port" \
"$server_bin" > "$tmp_dir/server.log" 2>&1 &
server_pid=$!

ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if (
        cd "$tmp_dir"
        TASKLINE_SERVER="$server_url" "$taskline_bin" project list --format json >/dev/null 2>&1
    ); then
        ready=1
        break
    fi
    sleep 0.25
done
if (( ready == 0 )); then
    cat "$tmp_dir/server.log" >&2
    exit 1
fi

(
    cd "$tmp_dir"
    TASKLINE_SERVER="$server_url" \
    TASKLINE_BIN="$taskline_bin" \
    "$repo_root/scripts/seed.sh" seed-integration \
        > "$tmp_dir/manifest.json" 2> "$tmp_dir/seed.err"
)
if grep -q "Traceback" "$tmp_dir/seed.err"; then
    cat "$tmp_dir/seed.err" >&2
    exit 1
fi
(
    cd "$tmp_dir"
    TASKLINE_SERVER="$server_url" \
    "$taskline_bin" task list --project seed-integration --format json > "$tmp_dir/tasks.json"
)

python3 - "$tmp_dir/manifest.json" "$tmp_dir/tasks.json" <<'PY'
import collections
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    manifest = json.load(source)
with open(sys.argv[2], encoding="utf-8") as source:
    task_rows = json.load(source)["tasks"]

def require(condition, message):
    if not condition:
        raise SystemExit(f"seed integration check failed: {message}")


require(manifest["schema_version"] == 1, "unexpected manifest schema")
require(manifest["project"]["name"] == "seed-integration", "unexpected project name")
require(len(manifest["tasks"]) == 8, "manifest task count is not 8")
require(len(manifest["edges"]) == 7, "manifest edge count is not 7")
require(len(task_rows) == 8, "server task count is not 8")

expected = {
    "mobile_notifications": ("Explore mobile notifications", "pending", 20, ["idea", "mobile"]),
    "onboarding_metrics": ("Define onboarding success metrics", "start", 90, ["product", "metrics"]),
    "invitation_flow": ("Design workspace invitation flow", "spec", 80, ["product", "ux"]),
    "role_access": ("Implement role-based access control", "dev", 75, ["backend", "security"]),
    "onboarding_checklist": ("Build onboarding checklist", "dev", 70, ["frontend", "onboarding"]),
    "invitation_edge_cases": ("Verify invitation edge cases", "test", 85, ["qa", "reliability"]),
    "keyboard_navigation": ("Add keyboard navigation", "start", 65, ["frontend", "accessibility"]),
    "rollout_plan": ("Document rollout and support plan", "spec", 55, ["docs", "operations"]),
}

rows_by_id = {row["id"]: row for row in task_rows}
for key, (title, state, priority, labels) in expected.items():
    task_ref = manifest["tasks"][key]
    require(task_ref["id"] in rows_by_id, f"{key} is missing from server task list")
    row = rows_by_id[task_ref["id"]]
    require(task_ref["state"] == state, f"{key} manifest state mismatch")
    require(row["title"] == title, f"{key} title mismatch")
    require(row["state"] == state, f"{key} server state mismatch")
    require(row["priority"] == priority, f"{key} priority mismatch")
    require(row["labels"] == labels, f"{key} labels mismatch")

expected_dependencies = collections.defaultdict(list)
for task_key, dependency_key in manifest["edges"]:
    expected_dependencies[task_key].append(manifest["tasks"][dependency_key]["id"])
for key, task_ref in manifest["tasks"].items():
    row = rows_by_id[task_ref["id"]]
    require(
        sorted(row.get("depends_on", [])) == sorted(expected_dependencies[key]),
        f"{key} dependencies mismatch",
    )

require(
    collections.Counter(row["state"] for row in task_rows)
    == {"pending": 1, "start": 2, "spec": 2, "dev": 2, "test": 1},
    "state distribution mismatch",
)
PY

if (
    cd "$tmp_dir"
    TASKLINE_SERVER="$server_url" \
    TASKLINE_BIN="$taskline_bin" \
    "$repo_root/scripts/seed.sh" seed-integration \
        > "$tmp_dir/duplicate.out" 2> "$tmp_dir/duplicate.err"
); then
    echo "error: duplicate seed unexpectedly succeeded" >&2
    exit 1
fi
if [[ -s "$tmp_dir/duplicate.out" ]]; then
    echo "error: duplicate seed wrote a success manifest" >&2
    exit 1
fi
grep -q "already exists" "$tmp_dir/duplicate.err"

(
    cd "$tmp_dir"
    TASKLINE_SERVER="$server_url" \
    "$taskline_bin" task list --project seed-integration --format json > "$tmp_dir/tasks-after-duplicate.json"
)
python3 - "$tmp_dir/tasks-after-duplicate.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    task_count = len(json.load(source)["tasks"])
if task_count != 8:
    raise SystemExit(f"duplicate seed changed task count to {task_count}")
PY

(
    cd "$tmp_dir"
    TASKLINE_SERVER="$server_url" \
    TASKLINE_BIN="$taskline_bin" \
    "$repo_root/scripts/seed.sh" "browser/e2e" > "$tmp_dir/browser-manifest.json"
)
browser_project_id="$(
    python3 - "$tmp_dir/browser-manifest.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    manifest = json.load(source)
if manifest["project"]["name"] != "browser/e2e":
    raise SystemExit("path-sensitive project name was not preserved")
if len(manifest["tasks"]) != 8:
    raise SystemExit("path-sensitive project manifest task count is not 8")
print(manifest["project"]["id"])
PY
)"
(
    cd "$tmp_dir"
    TASKLINE_SERVER="$server_url" \
    "$taskline_bin" task list \
        --project "$browser_project_id" \
        --format json > "$tmp_dir/browser-tasks.json"
)
python3 - "$tmp_dir/browser-tasks.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    task_count = len(json.load(source)["tasks"])
if task_count != 8:
    raise SystemExit(f"path-sensitive project has {task_count} server tasks")
PY

cat > "$tmp_dir/fake-taskline" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1 $2" == "project list" ]]; then
    echo '{"projects":[]}'
elif [[ "$1 $2" == "project create" ]]; then
    echo '{"id":"partial-project","name":"partial-demo"}'
elif [[ "$1 $2" == "task create" ]]; then
    count=0
    [[ -f "$FAKE_COUNT_FILE" ]] && count="$(cat "$FAKE_COUNT_FILE")"
    count=$((count + 1))
    echo "$count" > "$FAKE_COUNT_FILE"
    if (( count == 2 )); then
        echo "injected task creation failure" >&2
        exit 42
    fi
    printf '{"id":"task-%d"}\n' "$count"
else
    echo "unexpected fake CLI call: $*" >&2
    exit 64
fi
SH
chmod +x "$tmp_dir/fake-taskline"

if (
    cd "$tmp_dir"
    FAKE_COUNT_FILE="$tmp_dir/fake-count" \
    TASKLINE_BIN="$tmp_dir/fake-taskline" \
    "$repo_root/scripts/seed.sh" partial-demo \
        > "$tmp_dir/partial.out" 2> "$tmp_dir/partial.err"
); then
    echo "error: injected partial seed unexpectedly succeeded" >&2
    exit 1
fi
if [[ -s "$tmp_dir/partial.out" ]]; then
    echo "error: partial seed wrote a success manifest" >&2
    exit 1
fi
grep -q "partial project 'partial-demo' (partial-project)" "$tmp_dir/partial.err"
grep -q "mobile_notifications=task-1" "$tmp_dir/partial.err"

echo "ok: seed script integration and failure contracts"
