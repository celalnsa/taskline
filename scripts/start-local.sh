#!/usr/bin/env bash
# scripts/start-local.sh — build the server and (re)start it in the background.
#
# Behaviour:
#   1. Seeds .env from .env.example on first run if .env is missing.
#   2. Builds release artifacts via scripts/build.sh (skip with SKIP_BUILD=1).
#   3. Ensures .log/ exists.
#   4. If the configured port is held by a LISTEN-ing process, kills *only*
#      that process (TERM, then KILL after a short wait). Other processes
#      with the same binary name are left alone.
#   5. Launches ./dist/taskline-server detached from this shell, redirects
#      stdout+stderr to .log/server.log, writes the PID to .log/server.pid.
#
# Knobs:
#   PORT             — port to bind / check (default 8787). Exported to the
#                      server as TASKLINE_LISTEN=":$PORT" if TASKLINE_LISTEN
#                      is not already set, so port-in-use detection and the
#                      actual listen socket stay in sync.
#   TASKLINE_LISTEN  — full listen addr (e.g. ":8787" or
#                      "0.0.0.0:8787"); if set, takes precedence over PORT
#                      for the server, and PORT is parsed from it for the
#                      kill check. The default binds all interfaces.
#   SKIP_BUILD       — if set to a non-empty value, skip ./scripts/build.sh
#                      and require ./dist/taskline-server to already exist.
#                      Useful for fast iteration when only restarting after
#                      a Go-only edit and you ran `go build` yourself.
set -euo pipefail

cd "$(dirname "$0")/.."

# Resolve port. Prefer parsing TASKLINE_LISTEN if the user set it, so the
# port-occupancy check matches the address the server will actually bind.
if [[ -n "${TASKLINE_LISTEN:-}" ]]; then
    PORT="${TASKLINE_LISTEN##*:}"
else
    PORT="${PORT:-8787}"
    export TASKLINE_LISTEN=":$PORT"
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
    echo "[start-local] invalid port: '$PORT'" >&2
    exit 2
fi

# Warn (don't fail) if lsof is missing — without it we can't detect / kill
# a stale listener and the server will hit "address already in use".
if ! command -v lsof >/dev/null 2>&1; then
    echo "[start-local] warning: lsof not found — cannot free port $PORT if held" >&2
fi

# Seed .env from .env.example on first run, matching the old run-server.sh.
if [[ ! -f .env && -f .env.example ]]; then
    echo "[start-local] no .env, copying .env.example" >&2
    cp .env.example .env
fi

if [[ -n "${SKIP_BUILD:-}" ]]; then
    if [[ ! -x ./dist/taskline-server ]]; then
        echo "[start-local] SKIP_BUILD set but ./dist/taskline-server is missing" >&2
        exit 2
    fi
    echo "[start-local] SKIP_BUILD=1 — using existing ./dist/taskline-server" >&2
else
    echo "[start-local] building…" >&2
    ./scripts/build.sh
fi

mkdir -p .log

LOG_FILE=".log/server.log"
PID_FILE=".log/server.pid"

# Find the PID that is currently listening on $PORT. lsof's -sTCP:LISTEN
# filter ensures we don't kill a *client* connected to the port (which
# would otherwise also match `lsof -ti :$PORT`). -t prints PIDs only.
listen_pid() {
    if command -v lsof >/dev/null 2>&1; then
        lsof -ti ":$PORT" -sTCP:LISTEN 2>/dev/null || true
    fi
}

OLD_PIDS="$(listen_pid)"
if [[ -n "$OLD_PIDS" ]]; then
    echo "[start-local] port $PORT is in use by pid(s): $OLD_PIDS — killing" >&2
    # SIGTERM first.
    # shellcheck disable=SC2086
    kill $OLD_PIDS 2>/dev/null || true
    # Wait up to ~5s for graceful exit, then SIGKILL anything still listening.
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        sleep 0.5
        [[ -z "$(listen_pid)" ]] && break
    done
    REMAINING="$(listen_pid)"
    if [[ -n "$REMAINING" ]]; then
        echo "[start-local] pid(s) $REMAINING still listening — SIGKILL" >&2
        # shellcheck disable=SC2086
        kill -9 $REMAINING 2>/dev/null || true
        sleep 0.2
    fi
fi

# Truncate log on each start so it doesn't grow unbounded across restarts.
: > "$LOG_FILE"

if ! command -v python3 >/dev/null 2>&1; then
    echo "[start-local] python3 is required to launch a detached server" >&2
    exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
    echo "[start-local] curl is required to run health checks" >&2
    exit 2
fi

# Launch detached from this shell's process group. `nohup ... & disown` works
# in an interactive terminal, but some agent/CI command runners clean up the
# whole process group after the parent shell exits. Python's start_new_session
# gives the server its own session while still returning the actual child PID.
SERVER_PID="$(
    python3 - "$LOG_FILE" <<'PY'
import subprocess
import sys

log = open(sys.argv[1], "ab", buffering=0)
proc = subprocess.Popen(
    ["./dist/taskline-server"],
    stdin=subprocess.DEVNULL,
    stdout=log,
    stderr=subprocess.STDOUT,
    start_new_session=True,
)
print(proc.pid)
PY
)"

if [[ -z "$SERVER_PID" ]] || ! [[ "$SERVER_PID" =~ ^[0-9]+$ ]]; then
    echo "[start-local] failed to launch server via python3" >&2
    exit 1
fi

HEALTH_URL="http://127.0.0.1:${PORT}/healthz"
READY=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if curl -fsS --max-time 1 "$HEALTH_URL" >/dev/null 2>&1; then
        READY=1
        break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "[start-local] server (pid $SERVER_PID) exited before becoming healthy — see $LOG_FILE:" >&2
        tail -n 20 "$LOG_FILE" >&2 || true
        exit 1
    fi
    sleep 0.25
done

if [[ -z "$READY" ]]; then
    echo "[start-local] server (pid $SERVER_PID) did not become healthy at $HEALTH_URL — see $LOG_FILE:" >&2
    tail -n 20 "$LOG_FILE" >&2 || true
    exit 1
fi

echo "$SERVER_PID" > "$PID_FILE"

echo "started: pid=$SERVER_PID port=$PORT log=$LOG_FILE"
