#!/usr/bin/env bash
#
# worker-halt-hook.sh
#
# Intended to be invoked by the main worker CLI (e.g. 'grok') when its
# interactive turn / response has halted (finished).
#
# The CLI must be configured with a "halt", "stop", or equivalent hook that
# executes this script (or a wrapper that calls it).
#
# It notifies the broker, which forwards to the live session's watchdog so
# that "main worker stop" is recognized reliably instead of relying only on
# TUI screen scraping (spinners, "esc to interrupt", static regions, etc).
#
# Env vars (injected by the session wrapper when spawning the worker PTY):
#   AIMPARENCY_PROJECT     - path to the .bowman dir (or project root)
#   AIMPARENCY_AGENT_TYPE  - grok | claude | ...
#   AIMPARENCY_BROKER_URL  - http://localhost:5000 (or custom)
#
# Falls back to searching upward for .bowman if env not present.
set -euo pipefail

PROJECT="${AIMPARENCY_PROJECT:-}"
AGENT="${AIMPARENCY_AGENT_TYPE:-grok}"
BROKER_URL="${AIMPARENCY_BROKER_URL:-http://localhost:5000}"

if [[ -z "$PROJECT" ]]; then
  # Best-effort discovery: walk up from cwd looking for .bowman
  dir="$(pwd -P 2>/dev/null || pwd)"
  while [[ "$dir" != "/" && "$dir" != "." ]]; do
    if [[ -d "$dir/.bowman" ]]; then
      PROJECT="$dir/.bowman"
      break
    fi
    dir="$(dirname "$dir")"
  done
fi

if [[ -z "$PROJECT" ]]; then
  echo "[worker-halt-hook] Could not determine AIMPARENCY_PROJECT; skipping." >&2
  exit 0
fi

payload="{\"projectPath\":\"${PROJECT}\",\"agentType\":\"${AGENT}\"}"

# Preferred: tell the broker (it knows the live session port and forwards).
if curl -sS -X POST "${BROKER_URL}/trpc/watchdog.workerHalted" \
    -H 'content-type: application/json' \
    -d "$payload" >/dev/null 2>&1; then
  exit 0
fi

# Fallback: read the runtime sessions file written by the broker and POST
# directly to the session's internal halt endpoint. Works even if broker is
# unreachable (e.g. custom bind).
runtime_file="${PROJECT}/runtime/watchdog-sessions.json"
if [[ -f "$runtime_file" ]]; then
  # Very small jq-less extraction for the matching agent's port.
  port=$(node -e '
    const fs = require("fs");
    try {
      const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const sessions = (data && data.sessions) || [];
      const match = sessions.find(s => s.agentType === process.argv[2]);
      if (match && match.port) console.log(match.port);
    } catch(e) {}
  ' "$runtime_file" "$AGENT" || true)

  if [[ -n "$port" ]]; then
    curl -sS -X POST "http://localhost:${port}/_internal/worker-halt" \
      -d '{}' -H 'content-type: application/json' >/dev/null 2>&1 || true
  fi
fi

exit 0
