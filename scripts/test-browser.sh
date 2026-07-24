#!/usr/bin/env bash
# Run Playwright against an isolated built taskline server and seeded project.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
server_bin="$repo_root/dist/taskline-server"
taskline_bin="$repo_root/dist/taskline"
web_dir="$repo_root/web"
tmp_dir=""
server_pid=""
server_url=""

if [[ ! -x "$server_bin" || ! -x "$taskline_bin" ]]; then
    echo "error: browser test requires dist binaries; run 'make build' first" >&2
    exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
    echo "error: python3 is required for browser-test isolation" >&2
    exit 2
fi
if ! command -v pnpm >/dev/null 2>&1; then
    echo "error: pnpm is required to run Playwright" >&2
    exit 2
fi
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/taskline-browser-test.XXXXXX")"

clean_artifacts() {
    python3 - "$web_dir/test-results" "$web_dir/playwright-report" <<'PY'
import shutil
import sys

for path in sys.argv[1:]:
    shutil.rmtree(path, ignore_errors=True)
PY
}

stop_server() {
    if [[ -z "$server_pid" ]] || ! kill -0 "$server_pid" 2>/dev/null; then
        server_pid=""
        return
    fi
    kill -TERM "$server_pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
        if ! kill -0 "$server_pid" 2>/dev/null; then
            wait "$server_pid" 2>/dev/null || true
            server_pid=""
            return
        fi
        sleep 0.1
    done
    kill -KILL "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    server_pid=""
}

preserve_failure_artifacts() {
    artifact_dir="$web_dir/test-results/runtime"
    mkdir -p "$artifact_dir"
    for name in server.log seed.err manifest.json; do
        if [[ -f "$tmp_dir/$name" ]]; then
            cp "$tmp_dir/$name" "$artifact_dir/$name"
        fi
    done
}

cleanup() {
    status=$?
    stop_server
    if (( status == 0 )); then
        clean_artifacts
    else
        preserve_failure_artifacts
        echo "error: browser test artifacts: $web_dir/test-results and $web_dir/playwright-report" >&2
    fi
    python3 - "$tmp_dir" <<'PY'
import shutil
import sys

shutil.rmtree(sys.argv[1], ignore_errors=True)
PY
    exit "$status"
}
trap cleanup EXIT

random_port() {
    python3 - <<'PY'
import socket

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
}

start_server() {
    for attempt in 1 2 3 4 5; do
        port="$(random_port)"
        server_url="http://127.0.0.1:$port"
        : > "$tmp_dir/server.log"
        (
            cd "$tmp_dir"
            TASKLINE_DB="$tmp_dir/taskline.db" \
            TASKLINE_IMAGES_DIR="$tmp_dir/images" \
            TASKLINE_DOCS_DIR="$tmp_dir/docs" \
            TASKLINE_LISTEN="0.0.0.0:$port" \
            "$server_bin"
        ) > "$tmp_dir/server.log" 2>&1 &
        server_pid=$!

        for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
            if ! kill -0 "$server_pid" 2>/dev/null; then
                break
            fi
            if (
                cd "$tmp_dir"
                TASKLINE_SERVER="$server_url" "$taskline_bin" status --format json >/dev/null 2>&1
            ); then
                sleep 0.1
                if kill -0 "$server_pid" 2>/dev/null; then
                    return 0
                fi
                break
            fi
            sleep 0.25
        done

        echo "[browser] server attempt $attempt failed on port $port" >&2
        stop_server
    done
    cat "$tmp_dir/server.log" >&2
    return 1
}

clean_artifacts
start_server
echo "[browser] server=$server_url project=browser-e2e" >&2

(
    cd "$tmp_dir"
    TASKLINE_SERVER="$server_url" \
    TASKLINE_BIN="$taskline_bin" \
    "$repo_root/scripts/seed.sh" browser-e2e \
        > "$tmp_dir/manifest.json" 2> "$tmp_dir/seed.err"
)

(
    cd "$web_dir"
    TASKLINE_E2E_BASE_URL="$server_url" \
    TASKLINE_E2E_MANIFEST="$tmp_dir/manifest.json" \
    pnpm test:e2e
)

echo "ok: Playwright critical browser workflows"
