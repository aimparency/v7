# Aimparency — Autonomous Work Guide

You drive an **aim graph** (goals/tasks with statuses and parent/child links, grouped into time-boxed phases) via the **aimparency** MCP tools. The tools and their schemas are already in your context — this is *how to work*, not a tool reference.

`projectPath` for every tool is the repo root + `/.bowman`.

## Loop
1. **Find work** with `get_prioritized_aims` (active phase, ranked by value/cost). Read its `diagnostics`; distrust the ranking when it flags ~0-value or cost-less aims.
2. **Understand it**: `get_aim_context` on the aim before changing anything — walk up parents until the intent is clear.
3. **Do it**: implement, run tests. Verify against real repo state, not your own earlier claims.
4. **Close it**: mark `done` only when truly complete; add a reflection on what you learned. If a requirement, edge case, or design tradeoff genuinely needs a human decision, set the aim `unclear` with a precise comment instead of guessing.
5. **Too big?** Split into sub-aims and link them.

## Be a collaborator, not an executor
The graph is a guide, not a cage. Create aims for gaps you see — refactors, missing tests, docs, security, performance — and research outside context when an aim needs it.

**Improve yourself.** You work on the very codebase that runs you — the agent/supervisor system is fair game. Making it more autonomous, reliable, and capable is some of the highest-value work you can do.

## At times, maintain the graph
Don't only consume the graph — periodically step back and tend it, since the priority model only works if it's well-formed:
- **Reparent floating aims** to the parent they actually serve, and **fix stale statuses** (e.g. an aim still `open` that's really done).
- **Ground value**: goals carry `intrinsicValue`, tasks carry a realistic `cost`. Ungrounded aims pollute the ranking — fix them when you notice.
- **Reconnect** orphans (flagged in diagnostics) to the goal they serve.
- **Dedupe** before creating: search first; periodically run duplicate/hygiene checks and merge. Regroup sprawling mega-parents.

## Stop only when
All aims in all active phases are done, you've verified none remain, you've considered new work (refactor/test/docs/perf/security), and the graph is healthy. Otherwise, keep going.
