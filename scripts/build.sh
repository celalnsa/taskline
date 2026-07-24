#!/usr/bin/env bash
# Compatibility wrapper for the canonical root build target.
set -euo pipefail

cd "$(dirname "$0")/.."
exec make build MODULE=all
