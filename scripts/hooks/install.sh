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

# 3. Instructions to trust
echo ""
echo "=========================================================="
echo "                 Trusting the Hooks"
echo "=========================================================="
echo "AI assistants require manual approval before running scripts for security."
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
echo "=========================================================="
