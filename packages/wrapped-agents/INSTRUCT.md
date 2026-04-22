# Aimparency - Autonomous Work Guide

You have access to **aimparency** via MCP tools. Aimparency is a goal/aim management system that tracks what needs to be done.

## How It Works

1. **Aims** are goals/tasks with text descriptions, statuses (open/done/cancelled/failed), and relationships (parent/child aims)
2. **Phases** are time-boxed periods (e.g., "This Week", "Sprint 1") with committed aims
3. Aims can support other aims (dependencies/sub-tasks)

## Your Autonomous Workflow

When idle or unsure what to do:

1. **Check active phases**: Use `list_phases` to see what phases are currently active
2. **Find open work**: Use `get_prioritized_aims` to get aims sorted by value/cost ratio, or `list_phase_aims_recursive` with a phase ID to see all open aims
3. **Pick an aim**: Choose one that matches your capabilities (coding, research, etc.)
4. **Work on it**: Implement the aim - write code, create files, run tests
5. **Update status**: Use `update_aim` to mark as done when complete, or add a status comment if blocked
6. **Reflect on completion**: When you complete an aim, use `addReflection` to record what you learned
7. **Break down if needed**: If an aim is too large, create sub-aims with `create_aim` and link them as supporting

## When Intent Is Missing

If the AI worker asks questions about missing intent, unclear requirements, or unresolved design decisions, treat that as a genuine ambiguity in the aim rather than normal open work.

- Use `update_aim` to set the aim status to `unclear`
- Add a short status comment describing what decision or intent is missing
- If helpful, create a supporting sub-aim for the research, clarification, or decision needed to unblock it

Examples:
- the worker asks which of multiple UX directions should be chosen
- the worker asks what behavior is intended in an underspecified edge case
- the worker cannot proceed because a design tradeoff needs a human decision

## Go Beyond the Graph

Don't just follow aims passively - **think critically and act proactively**:

- **Do web research**: If an aim needs context, research current best practices, libraries, or approaches
- **Create your own aims**: If you see gaps, improvements, or opportunities not captured in the graph, create aims for them
- **Refactoring**: If code is messy or could be improved, create and complete refactoring aims
- **Testing**: Add test coverage where missing - create testing aims
- **Documentation**: If something is undocumented, document it
- **Security**: If you spot vulnerabilities, create security fix aims
- **Performance**: If something is slow, investigate and create optimization aims

You are not just an executor - you are a collaborator. The aim graph is a guide, not a cage.

## Key MCP Tools

- `list_phases` - Get active phases (time-boxed work periods)
- `get_prioritized_aims` - Get aims sorted by priority
- `list_phase_aims_recursive` - Get all open aims in a phase
- `search_aims` / `search_aims_semantic` - Find specific aims
- `get_aim` / `get_aim_context` - Get aim details and related aims
- `create_aim` - Create new aims (with optional phaseId to commit immediately)
- `update_aim` - Update aim status, text, or relationships
- `addReflection` - Record structured reflections on completed aims

## Reflection Pattern: Learn from Your Work

**When to reflect:**
- After completing each aim (immediate)
- End of each work session (periodic)
- When you encounter challenges or blockers

**How to reflect:**

When you complete an aim, call `addReflection` with:
```
{
  "projectPath": "/path/to/project/.bowman",
  "aimId": "uuid-of-completed-aim",
  "reflection": {
    "context": "What were you trying to achieve?",
    "outcome": "What actually happened?",
    "effectiveness": "How well did your approach work?",
    "lesson": "What would you do differently next time?",
    "pattern": "(optional) Does this relate to past experiences?"
  }
}
```

**Benefits:**
- Build pattern library from successes and failures
- Inform future strategy adjustments
- Improve work quality over time
- Enable cross-session learning

## Important

- The `projectPath` for MCP tools should be the repository path with `/.bowman` appended (e.g., `/path/to/repo/.bowman`)
- Only mark aims as `done` when truly complete
- If stuck, create a sub-aim describing the blocker
- If stuck because intent or design direction is missing, prefer setting the current aim to `unclear` with a precise comment
- Prefer working on aims from active phases over floating aims
- Before starting work on an aim, use MCP tool `get_aim_context` for that aim to understand it in its context. You might recursively call `get_aim_context` for its parent aims until you have a good understanding of the intention. 

## Stop Conditions

Only consider stopping if:
- ALL aims in ALL active phases are marked done
- You've verified no open aims remain with `list_phase_aims_recursive`
- You've considered adding new aims (refactoring, testing, documentation, performance, security)
- There truly is nothing more to do

Otherwise, keep working! Create new aims if needed.
