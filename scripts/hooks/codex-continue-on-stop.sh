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

# enable_continue_hook starts a timestamped progress log and points to it from
# .bowman/runtime/continue-hook-log; every block asks the agent to keep it up.
log_note=""
if [[ -n "$repo_root" && -s "$repo_root/.bowman/runtime/continue-hook-log" ]]; then
  log_file="$repo_root/$(head -n 1 "$repo_root/.bowman/runtime/continue-hook-log")"
  log_note=" Progress log for the human: after each finished step append one succinct line to $log_file (idea id and title, what changed, commit hash, or the question it is parked on)."
fi
block() {
  node -e 'process.stdout.write(JSON.stringify({ decision: "block", reason: process.argv[1] + process.argv[2] }) + "\n")' "$1" "$log_note"
}

if [[ "$human_wait_state" == "requested" ]]; then
  block 'Before waiting for a human, challenge the claimed blocker. Ideas waiting on the human are not a dead end, and a list full of them is not done. Check two things first: did the root and major ideas get fresh outside research and new hypotheses this session (major_hypothesis_loop, web research, ideation)? Does every idea waiting on the human have its step prepared (the draft email, the one-pager, the checklist, the options for a decision), so the human only has to send or pick? Then step back from the most recent scope. Re-orient in the Aimparency MCP; list every open and partially done idea (list_ideas), not only the top-ranked ones, and check each for actionable work; inspect graph hygiene and connection reflections; break down large abstract non-done ideas; dream up new hypotheses and safe experiments. Treat this as open-ended work, not a quick pass to justify stopping. Record what you try in graph state. Only if this broader search still proves that judgment, authorization, credentials, or an institutionally human action is indispensable should you restate the exact blocker and requested input, then end with [AIMPARENCY_CONFIRM_HUMAN_BLOCK].'
  exit 0
fi

block 'Commit your work before proceeding: the code and the .bowman idea files it changed go into the same commit, so git links each idea to its code; leave changes you did not make unstaged. Then continue working autonomously using the Aimparency MCP. Work is not only code: implementing, preparing the step a human has to take, researching and ideating are all regular work. Call get_prioritized_ideas (it includes the context of the top idea; use get_idea_context for others); the ranking shows only the top few, so before concluding nothing is actionable list all open and partially done ideas (list_ideas) and check each, however low it ranks. Advance the most valuable idea you can: implement and verify it, or, when it waits on the human, prepare its human step (draft the email, the one-pager, the checklist, the options for a decision) so the human only has to send it or pick. Record status and evidence (status comment) with update_idea, reflect on the hypotheses of its parent connections, then reprioritize and continue. When an idea needs a human decision, set it to unclear (human-dependent for a human action) with the exact question and the prepared material in the status comment and move on. Research and ideation under the root and major ideas are regular work, not a fallback for a thin list: there are endless ways to try. Look at the root ideas, run major_hypothesis_loop, go out and research (papers, products, people, funding), dream up new approaches, and record each as a sub idea with a hypothesis on its connection. Do not end a session without fresh outside research against the root idea. Every Aimparency MCP tool is yours to run (only the continue-hook toggles wait for the human), e.g. graph_hygiene and find_duplicate_ideas to tidy. Do not substitute Markdown planning for graph state. Preserve unrelated user changes. A request for the human is right only when the major ideas got fresh hypotheses this session, every waiting idea has its step prepared, and judgment, authorization, credentials, or an institutionally human action is genuinely indispensable. Then state the exact blocker and requested input, and end with [AIMPARENCY_REQUEST_HUMAN]. The hook will challenge that request once before it can yield.'
