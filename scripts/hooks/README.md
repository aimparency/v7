# Aimparency Codex Continuation Hook

> **This hook continues the current Codex conversation.** It does not contact
> the wrapped-agent broker and does not require a watchdog session.

There are two separate mechanisms in this repository:

| Mechanism | Purpose |
| --- | --- |
| [`codex-continue-on-stop.sh`](./codex-continue-on-stop.sh) | Blocks a Codex `Stop` event and creates another autonomous turn driven by the Aimparency MCP. |
| [`wrapped-worker-halt-notify.sh`](../../packages/wrapped-agents/common/hooks/wrapped-worker-halt-notify.sh) | Notifies an already-running wrapped-agent watchdog that its worker finished a turn. It cannot continue an ordinary Codex conversation. |

`on-stop.sh` and `worker-halt-hook.sh` remain only as deprecated compatibility
names. New integrations should use the explicit names above.

## Install the Codex loop in another repository

The target must be a Git repository with an initialized `.bowman/` directory:

```bash
./scripts/hooks/install.sh --target /path/to/project --agent codex
```

The installer:

- verifies `.bowman/` and the Git root;
- copies only the Codex continuation script and `.codex/hooks.json`;
- makes the script executable;
- validates the generated JSON and command target;
- runs blocking and non-blocking smoke tests from a nested directory; and
- prints the Codex restart and `/hooks` trust steps.

Re-running the command updates a recognized Aimparency hook in place and merges
exactly one managed Stop group into `.codex/hooks.json`, preserving unrelated
events and Stop handlers. It refuses to replace an unrecognized script already
at the managed path unless `--force` is supplied.

After installation, restart Codex in the target repository, run `/hooks`, and
trust `scripts/hooks/codex-continue-on-stop.sh`. Confirm that the Aimparency MCP
is connected and can access the target's `.bowman` graph.

Codex project hooks are configured in [`.codex/hooks.json`](../../.codex/hooks.json).
The hook command resolves through `git rev-parse --show-toplevel`, so starting
Codex from a repository subdirectory still works.

## Continuation contract

On a normal Codex `Stop`, the hook returns valid JSON with
`decision: "block"`. Its reason instructs Codex to use this graph loop:

1. call `get_prioritized_aims`;
2. orient with `get_aim_context`;
3. implement and verify the selected actionable aim;
4. record evidence and status with `update_aim` or `addReflection`; and
5. reprioritize instead of substituting Markdown planning for graph state.

Human waiting is an extreme-case, two-stage protocol. When Codex first believes
progress requires human judgment, authorization, credentials, or an
institutionally human action, it states the blocker and ends with
`[AIMPARENCY_REQUEST_HUMAN]`. The hook does **not** yield. It creates one more
turn challenging Codex to step back, inspect graph hygiene and reflections,
decompose abstract aims, dream up hypotheses, and try safe reversible work.
Only if that broader search still proves the human action indispensable may
Codex restate the exact request and end with
`[AIMPARENCY_CONFIRM_HUMAN_BLOCK]`; the hook then yields. Markers are recognized
only in Codex's `last_assistant_message`.

For a deliberate normal exit, launch Codex with:

```bash
AIMPARENCY_ALLOW_STOP=1 codex
```

The historical misspelling `AIMPARANCY_ALLOW_STOP=1` remains temporarily
supported but is deprecated.

## Verify locally

```bash
npm run test:hooks
```

This contract test installs into a disposable Git repository and verifies JSON,
stdin consumption, the MCP-specific continuation reason, both stop escape
variables, the two-stage human-wait challenge, nested-directory invocation,
executability, and exclusion of the wrapped-worker notifier.
