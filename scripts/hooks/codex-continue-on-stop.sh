#!/usr/bin/env bash
# Continue the current Codex conversation through the Aimparency MCP loop.

set -euo pipefail

# Codex sends the Stop event as JSON on stdin. Human waiting is deliberately a
# two-stage protocol: request, reconsider under challenge, then confirm.
stop_event="$(cat)"
human_wait_state="$(node -e '
  const event = JSON.parse(process.argv[1]);
  const message = typeof event.last_assistant_message === "string" ? event.last_assistant_message : "";
  if (message.includes("[AIMPARENCY_CONFIRM_HUMAN_BLOCK]")) process.stdout.write("confirmed");
  else if (message.includes("[AIMPARENCY_REQUEST_HUMAN]")) process.stdout.write("requested");
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

if [[ "$human_wait_state" == "requested" ]]; then
  printf '%s\n' \
    '{"decision":"block","reason":"Before waiting for a human, challenge the claimed blocker. Are you sure you cannot progress in any useful way? Step back from the most recent scope. Re-orient in the Aimparency MCP; inspect graph hygiene and reflections; break down large abstract non-done aims; dream up new hypotheses and safe experiments; and try to find valuable reversible work that needs no new authority. Record what you try in graph state. Only if this broader search still proves that judgment, authorization, credentials, or an institutionally human action is indispensable should you restate the exact blocker and requested input, then end with [AIMPARENCY_CONFIRM_HUMAN_BLOCK]."}'
  exit 0
fi

printf '%s\n' \
  '{"decision":"block","reason":"Continue working autonomously using the Aimparency MCP. Call get_prioritized_aims, orient with get_aim_context, select the next valuable actionable aim, implement and verify it, record evidence and status with update_aim/addReflection, then reprioritize and continue. Do not substitute Markdown planning for graph state. Preserve unrelated user changes. Ask the human only in extreme cases where judgment, authorization, credentials, or an institutionally human action is genuinely indispensable. Before asking, step back from the recent scope: try graph hygiene, reflection, dreaming, decomposing large abstract non-done aims, and safe new hypotheses or experiments. If you still believe a human response is required, state the exact blocker and requested input, then end with [AIMPARENCY_REQUEST_HUMAN]. The hook will challenge that request once before it can yield."}'
