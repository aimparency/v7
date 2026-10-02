# Aimparency MCP Integration

You are working in a project managed by Aimparency.
Aimparency organizes work into **Ideas** (goals/tasks) and **Phases** (time-boxed iterations).

## Core Workflow
1.  **Discovery:** Use `list_phases` to inspect the ordered phase tree. Then `list_ideas` (with `phaseId` and `status='open'`) to find open tasks.
2.  **Context:** Before starting work on any idea, use `get_idea_context(ideaId)` to understand the idea, its parents (why), and its children (how/dependencies).
3.  **Execution:** Implement the necessary changes.
4.  **Update:** Use `update_idea` to mark the idea as `implemented` and provide a comment explaining what was done.
5.  **Clarification:** When something is ambigous or unclear, set the idea's status to unclear, asking for clarification in the status comment, so that the user can provide clarification. 
6.  **Breakdown:** When ideas are too complex or high level, make an effort to break them down. Do research online and think. Store evaluatable explanations (hypothesis) at the idea connection. 

## Crucial Rules
-   **ProjectPath:** Always use the provided `projectPath` (usually ending in `.bowman`).
-   **Status:** Keep idea status up-to-date (`open`, `implemented`, `failed`, `cancelled`). Make status updates before git committments, so that they come at once. 
-   **Atomic Changes:** If an idea is too large, break it down using `create_idea` (as sub-ideas) instead of keeping it in progress for too long. There is also a prompt offered by the MCP for breaking down ideas that you can use.

## Tools
-   `list_ideas`, `get_idea`, `get_idea_context`
-   `create_idea`, `update_idea`, `delete_idea`
-   `list_phases`, `create_phase`
