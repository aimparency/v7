# Coding Assistant Hooks

This directory contains lifecycle hooks for AI coding assistants (like OpenAI Codex and Claude Code) to integrate them with the local Aimparency workflow.

## Available Hooks

### `on-stop.sh`
This hook runs whenever the AI assistant tries to stop. It returns a continuation
decision that sends the assistant back to Aimparency to select and execute the
next valuable aim.

For a deliberate normal exit, launch the assistant with
`AIMPARANCY_ALLOW_STOP=1` or interrupt the process directly.

## Setup & Configuration

To enable these hooks, you can run the convenience installer script:
```bash
./scripts/hooks/install.sh
```

### Manual Configuration

#### 1. OpenAI Codex
The hook configuration is checked into [.codex/hooks.json](file:///home/felix/dev/aimparency/v7/.codex/hooks.json). To enable it:
1. Ensure hooks are enabled in your global `~/.codex/config.toml`:
   ```toml
   [features]
   hooks = true
   ```
2. Start an interactive session with `codex`.
3. Run the `/hooks` slash command.
4. Press `t` to trust the `./scripts/hooks/on-stop.sh` script.

#### 2. Claude Code
The hook configuration is checked into [.claude/settings.json](file:///home/felix/dev/aimparency/v7/.claude/settings.json). To enable it:
1. Start an interactive session with `claude`.
2. Run the `/hooks` slash command.
3. Trust the `./scripts/hooks/on-stop.sh` script.

#### 3. Grok
The hook configuration is checked into [.grok/hooks/stop.json](file:///home/felix/dev/aimparency/v7/.grok/hooks/stop.json).
1. Trust the project once (`/hooks-trust` or launch with `--trust`). Folder trust is shared with MCP/LSP.
2. Reload hooks mid-session with `/hooks` then `r`, or start a new session.
3. Confirm the Stop hook is listed under Project in the Hooks tab.

Note: Grok also loads the Claude settings Stop hook via `[compat.claude] hooks = true` (default). The `.grok/hooks/` entry is the native project source of truth.
