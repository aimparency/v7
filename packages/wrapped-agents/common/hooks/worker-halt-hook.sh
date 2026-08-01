#!/usr/bin/env bash
# Deprecated compatibility name. Use wrapped-worker-halt-notify.sh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/wrapped-worker-halt-notify.sh" "$@"
