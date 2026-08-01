#!/usr/bin/env bash
# Deprecated compatibility name. Use codex-continue-on-stop.sh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/codex-continue-on-stop.sh"
