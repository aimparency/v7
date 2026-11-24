import { SPACE_TOOL_PROPERTY } from "../constants.js";
import { CONTINUE_HOOK_AGENTS, disableContinueHook, enableContinueHook } from "shared/continue-hook";
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

Aimparency provides lifecycle hooks for coding assistants (Codex, Claude Code, Antigravity / AGY) to enable autonomous continuation through the Aimparency MCP idea space loop.

There are two separate hook mechanisms:
- \`codex-continue-on-stop.sh\` (in \`scripts/hooks/\`): Blocks a coding assistant's stop event (Codex / Claude Code \`Stop\` or AGY \`post_invocation\`) and starts another autonomous turn driven by the Aimparency MCP space.
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
3. Verify that the Aimparency MCP is connected and has access to the target's \`.bowman/\` space.

---

## Autonomous Continuation & Human-Wait Protocol

### Space Loop (Normal Continuation)
When the coding assistant attempts to stop normally, the hook blocks the stop event and instructs the assistant to:
1. Call \`get_prioritized_ideas\`
2. Orient with \`get_idea_context\`
3. Advance the selected idea: implement and verify it, or, when it waits on the human, prepare the human's step (draft, one-pager, checklist, decision options) so the human only has to send or pick
4. Record status and evidence (status comment) with \`update_idea\`, reflect on each parent connection's hypothesis, and commit the code with the \`.bowman\` idea files it changed in one commit
5. Reprioritize and continue

The loop has no finished state. Exploring is the main work, not a fallback: research and ideation under the root and major ideas (\`major_hypothesis_loop\`, outside research), modeling, new hypotheses as sub ideas, and safe experiments to test them. Every Aimparency MCP tool may be run in the loop except the continue-hook toggles.

An idea that needs a human decision goes to \`unclear\` (\`human-dependent\` for a human action) with the exact question and the prepared material in its status comment; it leaves the priority list and the loop turns to other work. Waiting on the human is never a reason to stop.

### Two-Stage Human-Wait Protocol
The default loop stops only when the human explicitly told the agent in this session to stop or to wait:
1. The assistant says so and ends its response with \`[AIMPARENCY_REQUEST_HUMAN]\`.
2. The hook challenges the assistant once: anything else waiting on the human is parked in the space, and there is always more to explore (list_ideas, space hygiene, research, modeling, experiments).
3. If the human really asked, the assistant quotes their words and ends with \`[AIMPARENCY_CONFIRM_HUMAN_BLOCK]\`. The hook then yields to the human.

### Hook loops
What the hook tells the agent is a hook loop. The default is the Aimparency checkout's \`scripts/hooks/default-loop.md\`, read live on every Stop, so it follows Aimparency updates (a copy next to the installed hook is the fallback). Saved loops are versioned with the space in \`.bowman/hook-loops/<slug>.md\`: a \`# Title\` line, the text the agent gets when it tries to stop, and optionally a \`## When the agent asks for the human\` section with the challenge text (else the default's). Which loop runs is machine-local (\`.bowman/runtime/continue-hook-loop\`); pick one in the UI's Hook menu or with \`enable_continue_hook\`'s \`loop\`.

### Enable / Disable
Use the \`enable_continue_hook\` / \`disable_continue_hook\` tools (or the \`enable-hook\` / \`disable-hook\` prompts) only when the human asks. Disabling writes a machine-local flag (\`.bowman/runtime/continue-hook-disabled\`, gitignored) checked on every Stop — no hook-config reload needed.

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
pnpm test:hooks
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
        space: SPACE_TOOL_PROPERTY,
        agent: {
          type: "string",
          enum: [...CONTINUE_HOOK_AGENTS],
          description: "Coding assistant to install the hook for. Omit to only re-enable an already installed hook.",
        },
        loop: {
          type: "string",
          description: "Hook loop to run: \"default\" or the slug of a saved loop in .bowman/hook-loops/. Omit to keep the loop chosen last.",
        },
      },
      required: ["space"],
    },
    handler: async (args, trpcClient) => {
      const text = enableContinueHook(args.space as string, { agent: args.agent as string | undefined, loop: args.loop as string | undefined });
      return { content: [{ type: "text", text }] };
    },
  },
  {
    name: "disable_continue_hook",
    description: "Turn the Aimparency Stop continuation hook OFF for a repository (per-clone flag, effective from the next Stop, agent config untouched). Call ONLY when the human explicitly asks — never to escape the continuation loop on your own.",
    inputSchema: {
      type: "object",
      properties: {
        space: SPACE_TOOL_PROPERTY,
      },
      required: ["space"],
    },
    handler: async (args, trpcClient) => {
      const text = disableContinueHook(args.space as string);
      return { content: [{ type: "text", text }] };
    },
  },
];
