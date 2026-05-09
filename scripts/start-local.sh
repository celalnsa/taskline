#!/usr/bin/env bash
# scripts/start-local.sh — build the server and (re)start it in the background.
#
# Behaviour:
#   1. Builds release artifacts via scripts/build.sh.
#   2. Ensures .log/ exists.
#   3. If the configured port is held by a LISTEN-ing process, kills *only*
#      that process (TERM, then KILL after a short wait). Other processes
#      with the same binary name are left alone.
#   4. Launches ./dist/taskline-server with nohup, redirects stdout+stderr
#      to .log/server.log, writes the PID to .log/server.pid.
#
# Knobs:
#   PORT             — port to bind / check (default 8787). Exported to the
#                      server as TASKLINE_LISTEN=":$PORT" if TASKLINE_LISTEN
#                      is not already set, so port-in-use detection and the
#                      actual listen socket stay in sync.
#   TASKLINE_LISTEN  — full listen addr (e.g. "127.0.0.1:8787"); if set,
#                      takes precedence over PORT for the server, and PORT
#                      is parsed from it for the kill check.
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

echo "[start-local] building…" >&2
./scripts/build.sh

mkdir -p .log

LOG_FILE=".log/server.log"
PID_FILE=".log/server.pid"

# Find the PID that is currently listening on $PORT. lsof's -sTCP:LISTEN
# filter ensures we don't kill a *client* connected to the port (which
# would otherwise also match `lsof -ti :$PORT`). -t prints PIDs only.
listen_pid() {
    lsof -ti ":$PORT" -sTCP:LISTEN 2>/dev/null || true
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

# Launch detached. setsid (if available) divorces the server from this
# shell's process group so closing the terminal doesn't HUP it; nohup is
# the portable fallback.
if command -v setsid >/dev/null 2>&1; then
    setsid nohup ./dist/taskline-server >"$LOG_FILE" 2>&1 < /dev/null &
else
    nohup ./dist/taskline-server >"$LOG_FILE" 2>&1 < /dev/null &
fi
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

# Disown so this shell exiting doesn't kill the server.
disown "$SERVER_PID" 2>/dev/null || true

echo "started: pid=$SERVER_PID port=$PORT log=$LOG_FILE"
