import { PROJECT_PATH_TOOL_PROPERTY } from "../constants.js";
import { CONTINUE_HOOK_AGENTS, disableContinueHook, enableContinueHook } from "../continue-hook.js";
import type { ToolDefinition } from "./types.js";

export const hookTools: ToolDefinition[] = [
  {
    name: "install_hooks",
    description: "Returns the coding assistant hook installation and setup guide (for Codex continuation hooks, wrapped worker halt notification hooks, installation script usage, and human-wait protocols).",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (args, trpcClient) => {
      const guide = `# Aimparency Coding Assistant Hook Installation & Setup Guide

## Overview

Aimparency provides lifecycle hooks for coding assistants (Codex, Claude Code, Antigravity / AGY) to enable autonomous continuation through the Aimparency MCP idea graph loop.

There are two separate hook mechanisms:
- \`codex-continue-on-stop.sh\` (in \`scripts/hooks/\`): Blocks a coding assistant's stop event (Codex / Claude Code \`Stop\` or AGY \`post_invocation\`) and starts another autonomous turn driven by the Aimparency MCP graph.
- \`wrapped-worker-halt-notify.sh\` (in \`packages/wrapped-agents/common/hooks/\`): Notifies a running wrapped-agent watchdog that its worker finished a turn (does not continue an ordinary conversation).

---

## Installing Continuation Hook in a Target Repository

### Prerequisites
- Target directory must be a Git repository root.
- Target directory must contain an initialized \`.bowman/\` directory.

### Installation Command

Run the installer from the Aimparency repository:
\`\`\`bash
# For Codex (.codex/hooks.json):
./scripts/hooks/install.sh --target /path/to/project --agent codex

# For Claude Code (.claude/settings.json):
./scripts/hooks/install.sh --target /path/to/project --agent claude

# For Antigravity / AGY (.gemini/settings.json):
./scripts/hooks/install.sh --target /path/to/project --agent agy
\`\`\`

### What the Installer Does
1. Verifies the target is a Git root containing \`.bowman/\`.
2. Copies \`codex-continue-on-stop.sh\` to \`<target>/scripts/hooks/\`.
3. Idempotently merges a single managed continuation handler into \`<target>/.codex/hooks.json\` (Codex), \`<target>/.claude/settings.json\` (Claude Code) or \`<target>/.gemini/settings.json\` (AGY), preserving existing hooks.
4. Makes the script executable (\`chmod +x\`).
5. Validates JSON format and runs blocking/non-blocking smoke tests from a nested directory.

### Post-Installation Setup
1. Restart the coding assistant (Codex, Claude Code or AGY) in the target repository so it reloads project hooks.
2. For Codex, run \`/hooks\` and trust \`scripts/hooks/codex-continue-on-stop.sh\`. For Claude Code, check \`/hooks\` lists the Stop hook. For AGY, verify \`.gemini/settings.json\` \`post_invocation\` hook.
3. Verify that the Aimparency MCP is connected and has access to the target's \`.bowman/\` graph.

---

## Autonomous Continuation & Human-Wait Protocol

### Graph Loop (Normal Continuation)
When the coding assistant attempts to stop normally, the hook blocks the stop event and instructs the assistant to:
1. Call \`get_prioritized_ideas\`
2. Orient with \`get_idea_context\`
3. Implement and verify the selected actionable idea
4. Record evidence and status with \`update_idea\` or \`addReflection\`
5. Reprioritize and continue

### Two-Stage Human-Wait Protocol
If the assistant determines human intervention (credentials, explicit authorization, human judgment) is indispensable:
1. The assistant states the exact blocker and ends its response with \`[AIMPARENCY_REQUEST_HUMAN]\`.
2. The hook challenges the assistant once: stepping back to check graph hygiene, decompose abstract ideas, or find safe reversible work.
3. If human action is still strictly required, the assistant re-states the request and ends with \`[AIMPARENCY_CONFIRM_HUMAN_BLOCK]\`. The hook then yields to the human.

### Enable / Disable
Use the \`enable_continue_hook\` / \`disable_continue_hook\` tools (or the \`enable-hook\` / \`disable-hook\` prompts) only when the human asks. Disabling writes a per-clone flag (\`$(git rev-parse --git-path aimparency-continue-disabled)\`) checked on every Stop — no hook-config reload needed.

### Deliberate Exit
To allow the coding assistant to exit normally without triggering continuation:
\`\`\`bash
AIMPARENCY_ALLOW_STOP=1 codex
# or for Claude Code:
AIMPARENCY_ALLOW_STOP=1 claude
# or for AGY:
AIMPARENCY_ALLOW_STOP=1 agy
\`\`\`

---

## Testing & Verification

To verify hook contract integrity locally:
\`\`\`bash
npm run test:hooks
\`\`\``;

      return {
        content: [{
          type: "text",
          text: guide,
        }],
      };
    },
  },
  {
    name: "enable_continue_hook",
    description: "Turn the Aimparency Stop continuation hook ON for a repository; with agent, first installs it idempotently. Call ONLY when the human explicitly asks to enable/install the hook.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        agent: {
          type: "string",
          enum: [...CONTINUE_HOOK_AGENTS],
          description: "Coding assistant to install the hook for. Omit to only re-enable an already installed hook.",
        },
      },
      required: ["projectPath"],
    },
    handler: async (args, trpcClient) => {
      const text = enableContinueHook(args.projectPath as string, args.agent as string | undefined);
      return { content: [{ type: "text", text }] };
    },
  },
  {
    name: "disable_continue_hook",
    description: "Turn the Aimparency Stop continuation hook OFF for a repository (per-clone flag, effective from the next Stop, agent config untouched). Call ONLY when the human explicitly asks — never to escape the continuation loop on your own.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
      },
      required: ["projectPath"],
    },
    handler: async (args, trpcClient) => {
      const text = disableContinueHook(args.projectPath as string);
      return { content: [{ type: "text", text }] };
    },
  },
];
