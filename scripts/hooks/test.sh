#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_ROOT="$(mktemp -d)"
cleanup() { rm -rf "$TEST_ROOT"; }
trap cleanup EXIT

TARGET="$TEST_ROOT/target"
mkdir -p "$TARGET/.bowman/nested" "$TARGET/.codex"
git -C "$TARGET" init -q

cat >"$TARGET/.codex/hooks.json" <<'JSON'
{
  "description": "Target repository hooks",
  "hooks": {
    "PreToolUse": [{"matcher":"Bash","hooks":[{"type":"command","command":"./existing-check.sh"}]}],
    "Stop": [{"hooks":[{"type":"command","command":"./unrelated-stop.sh"}]}]
  }
}
JSON

"$SCRIPT_DIR/install.sh" --target "$TARGET" --agent codex >/dev/null

node -e '
  const fs = require("fs");
  const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const group = config.hooks.Stop[0];
  const handlers = config.hooks.Stop.flatMap(group => group.hooks || []);
  const managed = handlers.filter(hook => hook.command?.includes("codex-continue-on-stop.sh"));
  if (config.description !== "Target repository hooks") throw new Error("target description was overwritten");
  if (config.hooks.PreToolUse[0].hooks[0].command !== "./existing-check.sh") throw new Error("existing event was overwritten");
  if (!handlers.some(hook => hook.command === "./unrelated-stop.sh")) throw new Error("unrelated Stop hook was overwritten");
  if (managed.length !== 1) throw new Error("expected exactly one managed continuation hook");
  if ("matcher" in config.hooks.Stop.at(-1)) throw new Error("Stop matcher must be omitted");
  if (managed[0].command.includes("worker-halt")) throw new Error("watchdog notifier was installed");
' "$TARGET/.codex/hooks.json"

HOOK="$TARGET/scripts/hooks/codex-continue-on-stop.sh"
[[ -x "$HOOK" ]]
default_output="$(printf '{"hook_event_name":"Stop","stop_hook_active":false}\n' | "$HOOK")"
canonical_output="$(printf '{}\n' | AIMPARENCY_ALLOW_STOP=1 "$HOOK")"
legacy_output="$(printf '{}\n' | AIMPARANCY_ALLOW_STOP=1 "$HOOK")"
human_request_output="$(printf '%s\n' '{"hook_event_name":"Stop","last_assistant_message":"Input may be required. [AIMPARENCY_REQUEST_HUMAN]"}' | "$HOOK")"
human_confirm_output="$(printf '%s\n' '{"hook_event_name":"Stop","last_assistant_message":"Broader search exhausted; input is indispensable. [AIMPARENCY_CONFIRM_HUMAN_BLOCK]"}' | "$HOOK")"

node -e 'const x=JSON.parse(process.argv[1]); if(x.decision!=="block" || !x.reason.includes("Aimparency MCP") || !x.reason.includes("get_prioritized_aims") || !x.reason.includes("[AIMPARENCY_REQUEST_HUMAN]")) process.exit(1)' "$default_output"
node -e 'const x=JSON.parse(process.argv[1]); if(x.decision!=="block" || !x.reason.includes("challenge the claimed blocker") || !x.reason.includes("graph hygiene") || !x.reason.includes("[AIMPARENCY_CONFIRM_HUMAN_BLOCK]")) process.exit(1)' "$human_request_output"
node -e 'for(const s of process.argv.slice(1)){const x=JSON.parse(s); if(x.continue!==true || x.decision==="block") process.exit(1)}' "$canonical_output" "$legacy_output" "$human_confirm_output"

# The marker is authoritative only in Codex's last assistant message, never in
# another event field that could contain repository or user-controlled text.
untrusted_marker_output="$(printf '%s\n' '{"hook_event_name":"Stop","cwd":"[AIMPARENCY_CONFIRM_HUMAN_BLOCK]","last_assistant_message":"Work remains."}' | "$HOOK")"
node -e 'const x=JSON.parse(process.argv[1]); if(x.decision!=="block") process.exit(1)' "$untrusted_marker_output"

command="$(node -e 'const c=require(process.argv[1]); const h=c.hooks.Stop.flatMap(g=>g.hooks||[]).find(h=>h.command?.includes("codex-continue-on-stop.sh")); process.stdout.write(h.command)' "$TARGET/.codex/hooks.json")"
nested_output="$(cd "$TARGET/.bowman/nested" && printf '{}\n' | bash -c "$command")"
node -e 'const x=JSON.parse(process.argv[1]); if(x.decision!=="block") process.exit(1)' "$nested_output"

# A recognized older Aimparency install upgrades without --force and without
# duplicating its managed Stop group or touching unrelated hooks.
printf '%s\n' '#!/usr/bin/env bash' '# Continue the current Codex conversation through the Aimparency MCP loop.' 'printf old' >"$HOOK"
chmod +x "$HOOK"
"$SCRIPT_DIR/install.sh" --target "$TARGET" --agent codex >/dev/null
cmp -s "$SCRIPT_DIR/codex-continue-on-stop.sh" "$HOOK"
node -e '
  const c=require(process.argv[1]);
  const handlers=c.hooks.Stop.flatMap(g => g.hooks || []);
  if(handlers.filter(h => h.command?.includes("codex-continue-on-stop.sh")).length !== 1) process.exit(1);
  if(!handlers.some(h => h.command === "./unrelated-stop.sh")) process.exit(1);
  if(c.hooks.PreToolUse[0].hooks[0].command !== "./existing-check.sh") process.exit(1);
' "$TARGET/.codex/hooks.json"

# A custom script occupying the managed path is never overwritten implicitly.
CONFLICT_TARGET="$TEST_ROOT/conflict-target"
mkdir -p "$CONFLICT_TARGET/.bowman" "$CONFLICT_TARGET/scripts/hooks"
git -C "$CONFLICT_TARGET" init -q
printf '%s\n' '#!/usr/bin/env bash' 'printf custom' >"$CONFLICT_TARGET/scripts/hooks/codex-continue-on-stop.sh"
chmod +x "$CONFLICT_TARGET/scripts/hooks/codex-continue-on-stop.sh"
if "$SCRIPT_DIR/install.sh" --target "$CONFLICT_TARGET" --agent codex >/dev/null 2>&1; then
  echo "Installer overwrote an unrecognized managed-path script" >&2
  exit 1
fi
grep -qF 'printf custom' "$CONFLICT_TARGET/scripts/hooks/codex-continue-on-stop.sh"

# Malformed existing Stop configuration fails before either target asset is
# changed, rather than silently discarding configuration it cannot merge.
MALFORMED_TARGET="$TEST_ROOT/malformed-target"
mkdir -p "$MALFORMED_TARGET/.bowman" "$MALFORMED_TARGET/.codex" "$MALFORMED_TARGET/scripts/hooks"
git -C "$MALFORMED_TARGET" init -q
printf '%s\n' '{"hooks":{"Stop":{"hooks":[]}}}' >"$MALFORMED_TARGET/.codex/hooks.json"
printf '%s\n' '#!/usr/bin/env bash' '# Continue the current Codex conversation through the Aimparency MCP loop.' 'printf old' >"$MALFORMED_TARGET/scripts/hooks/codex-continue-on-stop.sh"
chmod +x "$MALFORMED_TARGET/scripts/hooks/codex-continue-on-stop.sh"
cp "$MALFORMED_TARGET/.codex/hooks.json" "$TEST_ROOT/malformed-hooks.before"
cp "$MALFORMED_TARGET/scripts/hooks/codex-continue-on-stop.sh" "$TEST_ROOT/malformed-script.before"
if "$SCRIPT_DIR/install.sh" --target "$MALFORMED_TARGET" --agent codex >/dev/null 2>&1; then
  echo "Installer accepted malformed existing Stop configuration" >&2
  exit 1
fi
cmp -s "$TEST_ROOT/malformed-hooks.before" "$MALFORMED_TARGET/.codex/hooks.json"
cmp -s "$TEST_ROOT/malformed-script.before" "$MALFORMED_TARGET/scripts/hooks/codex-continue-on-stop.sh"

# The separate wrapped-worker notifier must infer a unique agent, reject an
# ambiguous one instead of defaulting to Grok, and inspect tRPC success:false.
WORKER_PROJECT="$TEST_ROOT/worker-project"
mkdir -p "$WORKER_PROJECT/.bowman/runtime" "$TEST_ROOT/bin"
cat >"$TEST_ROOT/bin/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$MOCK_CURL_LOG"
case "$*" in
  *watchdog.workerHalted*) printf '%s\n' "${MOCK_BROKER_RESPONSE:-{\"result\":{\"data\":{\"success\":true}}}}" ;;
  *) printf '{"ok":true}\n' ;;
esac
MOCK_CURL
chmod +x "$TEST_ROOT/bin/curl"

cat >"$WORKER_PROJECT/.bowman/runtime/watchdog-sessions.json" <<'JSON'
{"sessions":[{"agentType":"codex","port":7444}]}
JSON
MOCK_CURL_LOG="$TEST_ROOT/curl.log" \
MOCK_BROKER_RESPONSE='{"result":{"data":{"success":false,"reason":"no active session"}}}' \
PATH="$TEST_ROOT/bin:$PATH" AIMPARENCY_PROJECT="$WORKER_PROJECT" \
  "$REPO_DIR/packages/wrapped-agents/common/hooks/wrapped-worker-halt-notify.sh"
grep -q '"agentType":"codex"' "$TEST_ROOT/curl.log"
grep -q 'localhost:7444/_internal/worker-halt' "$TEST_ROOT/curl.log"

: >"$TEST_ROOT/curl.log"
cat >"$WORKER_PROJECT/.bowman/runtime/watchdog-sessions.json" <<'JSON'
{"sessions":[{"agentType":"codex","port":7444},{"agentType":"grok","port":7555}]}
JSON
MOCK_CURL_LOG="$TEST_ROOT/curl.log" PATH="$TEST_ROOT/bin:$PATH" \
AIMPARENCY_PROJECT="$WORKER_PROJECT" \
  "$REPO_DIR/packages/wrapped-agents/common/hooks/wrapped-worker-halt-notify.sh" 2>/dev/null
[[ ! -s "$TEST_ROOT/curl.log" ]]

echo "Aimparency Codex continuation hook contract: PASS"
