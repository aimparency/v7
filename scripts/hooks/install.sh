#!/usr/bin/env bash
# install.sh - Sets up executable permissions and verifies assistant config for hooks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=========================================================="
echo "      Aimparency Coding Assistant Hooks Installer"
echo "=========================================================="
echo ""

# 1. Make hooks executable
echo "Step 1: Setting executable permissions..."
if chmod +x "$SCRIPT_DIR/on-stop.sh"; then
  echo "  ✓ scripts/hooks/on-stop.sh is now executable."
else
  echo "  ✗ Failed to set executable permissions on stop script."
fi

# 2. Verify Codex config
echo ""
echo "Step 2: Checking global Codex configuration..."
CODEX_CONFIG="$HOME/.codex/config.toml"
if [[ -f "$CODEX_CONFIG" ]]; then
  if grep -q "hooks *= *true" "$CODEX_CONFIG"; then
    echo "  ✓ Codex global hooks are enabled in $CODEX_CONFIG."
  else
    echo "  ⚠️  Codex hooks are not enabled in $CODEX_CONFIG."
    echo "     Please ensure the following block exists in your global configuration:"
    echo "     [features]"
    echo "     hooks = true"
  fi
else
  echo "  ℹ️  No global Codex configuration found at $CODEX_CONFIG."
fi

# 3. Verify Grok project hook is present
echo ""
echo "Step 3: Checking Grok project hook configuration..."
GROK_HOOK="$REPO_DIR/.grok/hooks/stop.json"
if [[ -f "$GROK_HOOK" ]]; then
  echo "  ✓ Found $GROK_HOOK"
else
  echo "  ⚠️  Missing $GROK_HOOK (create it or restore from git)."
fi

# 4. Verify Antigravity / AGY project hook configuration
echo ""
echo "Step 4: Checking Antigravity (AGY) project hook configuration..."
AGY_CONFIG="$REPO_DIR/.gemini/settings.json"
if [[ -f "$AGY_CONFIG" ]]; then
  echo "  ✓ Found $AGY_CONFIG with post_invocation hook."
else
  echo "  ⚠️  Missing $AGY_CONFIG (create it or restore from git)."
fi

# 5. Instructions to trust
echo ""
echo "=========================================================="
echo "                 Trusting the Hooks"
echo "=========================================================="
echo "AI assistants require manual approval before running scripts for security."
echo ""
echo "👉 For Antigravity / AGY:"
echo "   1. Launch 'agy' in this directory."
echo "   2. Run the slash command: /hooks"
echo "   3. Trust the './scripts/hooks/on-stop.sh' hook under post_invocation."
echo ""
echo "👉 For Codex:"
echo "   1. Run 'codex' in this directory."
echo "   2. Type the slash command: /hooks"
echo "   3. Press 't' to trust the './scripts/hooks/on-stop.sh' hook."
echo ""
echo "👉 For Claude Code:"
echo "   1. Run 'claude' in this directory."
echo "   2. Type the slash command: /hooks"
echo "   3. Trust the './scripts/hooks/on-stop.sh' hook."
echo ""
echo "👉 For Grok:"
echo "   1. Trust the project once: /hooks-trust (or launch with --trust)."
echo "   2. Reload hooks: /hooks then press 'r' (or start a new session)."
echo "   3. Confirm Project Stop → ../../scripts/hooks/on-stop.sh is listed."
echo "=========================================================="
