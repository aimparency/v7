#!/usr/bin/env bash
# Notify an already-running wrapped-agent watchdog that its worker halted.
# This does not continue a Codex conversation and is not a Codex Stop hook.

set -euo pipefail

PROJECT="${AIMPARENCY_PROJECT:-}"
AGENT="${AIMPARENCY_AGENT_TYPE:-}"
BROKER_URL="${AIMPARENCY_BROKER_URL:-http://localhost:5000}"

if [[ -z "$PROJECT" ]]; then
  dir="$(pwd -P 2>/dev/null || pwd)"
  while [[ "$dir" != "/" && "$dir" != "." ]]; do
    if [[ -d "$dir/.bowman" ]]; then
      PROJECT="$dir"
      break
    fi
    dir="$(dirname "$dir")"
  done
fi

if [[ -z "$PROJECT" ]]; then
  echo "[wrapped-worker-halt-notify] Could not determine AIMPARENCY_PROJECT; not notifying." >&2
  exit 0
fi

if [[ -d "$PROJECT/.bowman" ]]; then
  AIMPARENCY_DIR="$PROJECT/.bowman"
elif [[ "$(basename "$PROJECT")" == ".bowman" && -d "$PROJECT" ]]; then
  AIMPARENCY_DIR="$PROJECT"
else
  echo "[wrapped-worker-halt-notify] Project has no .bowman directory: $PROJECT" >&2
  exit 0
fi

runtime_file="$AIMPARENCY_DIR/runtime/watchdog-sessions.json"
if [[ -z "$AGENT" && -f "$runtime_file" ]]; then
  AGENT="$(node -e '
    const fs = require("fs");
    try {
      const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const types = [...new Set(((data && data.sessions) || []).map(s => s.agentType).filter(Boolean))];
      if (types.length === 1) process.stdout.write(types[0]);
    } catch {}
  ' "$runtime_file")"
fi

if [[ -z "$AGENT" ]]; then
  echo "[wrapped-worker-halt-notify] AIMPARENCY_AGENT_TYPE is required when it cannot be inferred uniquely." >&2
  exit 0
fi

payload="$(node -e 'process.stdout.write(JSON.stringify({projectPath:process.argv[1],agentType:process.argv[2]}))' "$PROJECT" "$AGENT")"

# HTTP success is insufficient: tRPC may return success:false with status 200.
broker_response="$(curl -fsS -X POST "${BROKER_URL}/trpc/watchdog.workerHalted" \
  -H 'content-type: application/json' -d "$payload" 2>/dev/null || true)"
if [[ -n "$broker_response" ]] && node -e '
  try {
    const body = JSON.parse(process.argv[1]);
    const data = body?.result?.data?.json ?? body?.result?.data ?? body;
    process.exit(data?.success === true ? 0 : 1);
  } catch { process.exit(1); }
' "$broker_response"; then
  exit 0
fi

# Broker missing/no-active-session: find the matching live session locally.
if [[ -f "$runtime_file" ]]; then
  port="$(node -e '
    const fs = require("fs");
    try {
      const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const match = ((data && data.sessions) || []).find(s => s.agentType === process.argv[2]);
      if (match && Number.isInteger(match.port)) process.stdout.write(String(match.port));
    } catch {}
  ' "$runtime_file" "$AGENT")"

  if [[ -n "$port" ]]; then
    curl -fsS -X POST "http://localhost:${port}/_internal/worker-halt" \
      -d '{}' -H 'content-type: application/json' >/dev/null 2>&1 || true
  fi
fi

exit 0
