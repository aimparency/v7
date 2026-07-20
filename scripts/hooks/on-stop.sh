#!/usr/bin/env bash
# Keep the coding loop alive. Set AIMPARANCY_ALLOW_STOP=1 for a deliberate exit.

set -euo pipefail

# Consume the hook payload so callers can close stdin cleanly.
cat >/dev/null

if [[ "${AIMPARANCY_ALLOW_STOP:-0}" == "1" ]]; then
  printf '{"continue":true}\n'
  exit 0
fi

printf '%s\n' \
  '{"decision":"block","reason":"Continue working autonomously. Re-orient in Aimparency, select the next valuable actionable aim, execute and verify it, record the result, and continue. Ask the human only when judgment, authorization, credentials, or an institutionally human action is genuinely required."}'
