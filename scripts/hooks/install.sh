#!/usr/bin/env bash
# Install the Aimparency Codex continuation loop into another .bowman project.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET=""
AGENT=""
FORCE=0

usage() {
  cat <<'EOF'
Usage: ./scripts/hooks/install.sh --target /path/to/project --agent codex [--force]

Installs only the Codex conversation-continuation hook. It never installs the
wrapped-agent worker-halt notification hook.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || { echo "--target requires a path" >&2; exit 2; }
      TARGET="$2"
      shift 2
      ;;
    --agent)
      [[ $# -ge 2 ]] || { echo "--agent requires a value" >&2; exit 2; }
      AGENT="$2"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ -n "$TARGET" ]] || { echo "--target is required" >&2; exit 2; }
[[ "$AGENT" == "codex" ]] || { echo "Only --agent codex is currently supported" >&2; exit 2; }
TARGET="$(cd "$TARGET" 2>/dev/null && pwd -P)" || { echo "Target does not exist" >&2; exit 1; }
[[ -d "$TARGET/.bowman" ]] || { echo "Target must contain .bowman/: $TARGET" >&2; exit 1; }
git_root="$(git -C "$TARGET" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Target must be inside a Git repository: $TARGET" >&2
  exit 1
}
git_root="$(cd "$git_root" && pwd -P)"
[[ "$git_root" == "$TARGET" ]] || {
  echo "--target must be the Git repository root: $git_root" >&2
  exit 1
}

HOOK_DIR="$TARGET/scripts/hooks"
CONFIG_DIR="$TARGET/.codex"
HOOK_PATH="$HOOK_DIR/codex-continue-on-stop.sh"
CONFIG_PATH="$CONFIG_DIR/hooks.json"

config_tmp="$(mktemp)"
cleanup() { rm -f "$config_tmp"; }
trap cleanup EXIT

if [[ -e "$HOOK_PATH" ]] && ! cmp -s "$SCRIPT_DIR/codex-continue-on-stop.sh" "$HOOK_PATH"; then
  if ! grep -qF 'Continue the current Codex conversation through the Aimparency MCP loop.' "$HOOK_PATH" \
    && [[ "$FORCE" != "1" ]]; then
    echo "Refusing to overwrite unrecognized script: $HOOK_PATH (use --force)" >&2
    exit 1
  fi
fi

# Merge exactly one managed Aimparency Stop group. Existing hook events and
# unrelated Stop handlers remain byte-for-byte equivalent as parsed JSON.
node - "$CONFIG_PATH" "$config_tmp" <<'NODE'
const fs = require("fs");
const [source, destination] = process.argv.slice(2);
let config = {};
if (fs.existsSync(source)) {
  config = JSON.parse(fs.readFileSync(source, "utf8"));
  if (!config || Array.isArray(config) || typeof config !== "object") {
    throw new Error("Existing .codex/hooks.json must contain a JSON object");
  }
}
if (!config.description) {
  config.description = "Continue autonomous Aimparency work when Codex tries to stop.";
}
if (config.hooks === undefined) {
  config.hooks = {};
} else if (!config.hooks || Array.isArray(config.hooks) || typeof config.hooks !== "object") {
  throw new Error("Existing hooks must be a JSON object");
}
if (config.hooks.Stop !== undefined && !Array.isArray(config.hooks.Stop)) {
  throw new Error("Existing hooks.Stop must be an array");
}
const isManaged = (handler) =>
  handler && handler.type === "command" && typeof handler.command === "string" &&
  (handler.command.includes("scripts/hooks/codex-continue-on-stop.sh") ||
   handler.command.includes("scripts/hooks/on-stop.sh"));
const stopGroups = Array.isArray(config.hooks.Stop) ? config.hooks.Stop : [];
config.hooks.Stop = stopGroups.flatMap((group) => {
  if (!group || typeof group !== "object" || Array.isArray(group) || !Array.isArray(group.hooks)) {
    throw new Error("Every existing hooks.Stop entry must be an object with a hooks array");
  }
  const hooks = group.hooks.filter((handler) => !isManaged(handler));
  return hooks.length ? [{ ...group, hooks }] : [];
});
config.hooks.Stop.push({
  hooks: [{
    type: "command",
    command: "\"$(git rev-parse --show-toplevel)/scripts/hooks/codex-continue-on-stop.sh\"",
    statusMessage: "Checking for the next Aimparency aim...",
    timeout: 10
  }]
});
fs.writeFileSync(destination, `${JSON.stringify(config, null, 2)}\n`);
NODE

mkdir -p "$HOOK_DIR" "$CONFIG_DIR"
cp "$SCRIPT_DIR/codex-continue-on-stop.sh" "$HOOK_PATH"
cp "$config_tmp" "$CONFIG_PATH"
chmod +x "$HOOK_PATH"

# Validate the installed contract, including Git-root resolution from a nested cwd.
node -e 'const fs=require("fs"); const p=process.argv[1]; const c=JSON.parse(fs.readFileSync(p,"utf8")); const hs=(c.hooks?.Stop||[]).flatMap(g=>g.hooks||[]).filter(h=>h.command?.includes("codex-continue-on-stop.sh")); if(hs.length!==1 || hs[0].type!=="command" || hs[0].command.includes("worker-halt")) process.exit(1)' "$CONFIG_PATH"
[[ -x "$HOOK_PATH" ]] || { echo "Installed hook is not executable" >&2; exit 1; }

nested_dir="$TARGET/.bowman"
hook_command="$(node -e 'const c=require(process.argv[1]); const h=c.hooks.Stop.flatMap(g=>g.hooks||[]).find(h=>h.command?.includes("codex-continue-on-stop.sh")); process.stdout.write(h.command)' "$CONFIG_PATH")"
blocked_output="$(cd "$nested_dir" && printf '{"hook_event_name":"Stop"}\n' | bash -c "$hook_command")"
allowed_output="$(cd "$nested_dir" && printf '{"hook_event_name":"Stop"}\n' | AIMPARENCY_ALLOW_STOP=1 bash -c "$hook_command")"
node -e 'const x=JSON.parse(process.argv[1]); if(x.decision!=="block" || !x.reason.includes("Aimparency MCP")) process.exit(1)' "$blocked_output"
node -e 'const x=JSON.parse(process.argv[1]); if(x.continue!==true || x.decision==="block") process.exit(1)' "$allowed_output"

echo "Installed and smoke-tested the Aimparency Codex loop in: $TARGET"
echo "Next steps:"
echo "  1. Restart Codex in the target repository so it reloads project hooks."
echo "  2. Run /hooks and trust scripts/hooks/codex-continue-on-stop.sh."
echo "  3. Confirm the Aimparency MCP is connected and can read $TARGET/.bowman."
echo "For a deliberate normal stop: AIMPARENCY_ALLOW_STOP=1 codex"
