#!/usr/bin/env bash
# Shell-friendly wrapper for the canonical root test target.
set -euo pipefail

cd "$(dirname "$0")/.."

if (( $# > 1 )); then
    echo "usage: $0 [all|server|cli|web]" >&2
    exit 2
fi

exec make test MODULE="${1:-all}"
