#!/usr/bin/env bash
# Continue the current Codex conversation through the Aimparency MCP loop.

set -euo pipefail

# Codex sends the Stop event as JSON on stdin. Human waiting is deliberately a
# two-stage protocol: request, reconsider under challenge, then confirm.
stop_event="$(cat)"

# A machine-local off switch toggled by the enable/disable_continue_hook MCP
# tools: .bowman/runtime/continue-hook-disabled (gitignored). Checked on every
# Stop, so it works without the agent reloading its hook config. The flag's old
# place inside .git is still honored.
hook_dir="$(dirname "${BASH_SOURCE[0]}")"
repo_root="$(git -C "$hook_dir" rev-parse --show-toplevel 2>/dev/null || true)"
legacy_flag="$(git -C "$hook_dir" rev-parse --path-format=absolute --git-path aimparency-continue-disabled 2>/dev/null || true)"

# What the turn cost goes to the ideas it changed (record-session-cost.mjs from
# the Aimparency checkout, so it follows updates; in the background, so the hook
# never waits for it or fails with it).
cost_recorder="$hook_dir/record-session-cost.mjs"
if [[ -n "$repo_root" && -s "$repo_root/.bowman/runtime/continue-hook-default" ]]; then
  live_recorder="$(dirname "$(head -n 1 "$repo_root/.bowman/runtime/continue-hook-default")")/record-session-cost.mjs"
  [[ -f "$live_recorder" ]] && cost_recorder="$live_recorder"
fi
if [[ -n "$repo_root" && -f "$cost_recorder" ]]; then
  (printf '%s' "$stop_event" | node "$cost_recorder" "$repo_root" >/dev/null 2>&1 &)
fi
if [[ -n "$repo_root" && -e "$repo_root/.bowman/runtime/continue-hook-disabled" ]] || [[ -n "$legacy_flag" && -e "$legacy_flag" ]]; then
  printf '{"continue":true}\n'
  exit 0
fi

human_wait_state="$(node -e '
  const event = JSON.parse(process.argv[1]);
  // Markers count only as the final token, so merely quoting one mid-message
  // (e.g. while documenting the protocol) does not trigger a human wait.
  const message = typeof event.last_assistant_message === "string" ? event.last_assistant_message.trimEnd() : "";
  if (message.endsWith("[AIMPARENCY_CONFIRM_HUMAN_BLOCK]")) process.stdout.write("confirmed");
  else if (message.endsWith("[AIMPARENCY_REQUEST_HUMAN]")) process.stdout.write("requested");
  else process.stdout.write("none");
' "$stop_event")"
if [[ "$human_wait_state" == "confirmed" ]]; then
  printf '{"continue":true}\n'
  exit 0
fi

# AIMPARENCY_ALLOW_STOP is canonical. Retain the historical misspelling for a
# deprecation window so existing launch scripts can still request a normal stop.
if [[ "${AIMPARENCY_ALLOW_STOP:-${AIMPARANCY_ALLOW_STOP:-0}}" == "1" ]]; then
  printf '{"continue":true}\n'
  exit 0
fi

# The text the agent gets is a hook loop: the one named in
# .bowman/runtime/continue-hook-loop (a slug of .bowman/hook-loops/<slug>.md,
# versioned with the space), else the default. The default is read live from
# the Aimparency checkout named in .bowman/runtime/continue-hook-default (written
# on install), so it follows Aimparency updates; default-loop.md next to this
# script is only the fallback when that checkout is missing. A loop
# file is "# Title", the work text, and optionally a "## When the agent asks for
# the human" section with the challenge text (else the default's).
active_loop=""
if [[ -n "$repo_root" && -s "$repo_root/.bowman/runtime/continue-hook-loop" ]]; then
  active_slug="$(head -n 1 "$repo_root/.bowman/runtime/continue-hook-loop")"
  if [[ "$active_slug" =~ ^[a-z0-9-]+$ && -f "$repo_root/.bowman/hook-loops/$active_slug.md" ]]; then
    active_loop="$repo_root/.bowman/hook-loops/$active_slug.md"
  fi
fi

default_loop="$hook_dir/default-loop.md"
if [[ -n "$repo_root" && -s "$repo_root/.bowman/runtime/continue-hook-default" ]]; then
  live_default="$(head -n 1 "$repo_root/.bowman/runtime/continue-hook-default")"
  [[ -f "$live_default" ]] && default_loop="$live_default"
fi

# enable_continue_hook starts a timestamped progress log and points to it from
# .bowman/runtime/continue-hook-log; every block asks the agent to keep it up.
log_note=""
if [[ -n "$repo_root" && -s "$repo_root/.bowman/runtime/continue-hook-log" ]]; then
  log_file="$repo_root/$(head -n 1 "$repo_root/.bowman/runtime/continue-hook-log")"
  log_note=" Progress log for the human: after each finished step append one succinct line to $log_file (idea id and title, what changed, commit hash, or the question it is parked on)."
fi

node -e '
  const fs = require("fs");
  const [state, activeLoop, defaultLoop, logNote] = process.argv.slice(1);
  const HUMAN_HEADING = /^## When the agent asks for the human[ \t]*$/m;
  const parse = (file) => {
    if (!file || !fs.existsSync(file)) return {};
    const text = fs.readFileSync(file, "utf8").replace(/^# .*\n/, "");
    const [work, human] = text.split(HUMAN_HEADING);
    return { work: work.trim() || undefined, human: human?.trim() || undefined };
  };
  const active = parse(activeLoop);
  const fallback = parse(defaultLoop);
  const text = state === "requested"
    ? active.human ?? fallback.human ?? "Before waiting for a human, re-check the Aimparency MCP for actionable work. If input is still indispensable, restate the blocker and end with [AIMPARENCY_CONFIRM_HUMAN_BLOCK]."
    : active.work ?? fallback.work ?? "Continue working autonomously using the Aimparency MCP. When human input is indispensable, state it and end with [AIMPARENCY_REQUEST_HUMAN].";
  process.stdout.write(JSON.stringify({ decision: "block", reason: text + logNote }) + "\n");
' "$human_wait_state" "$active_loop" "$default_loop" "$log_note"
