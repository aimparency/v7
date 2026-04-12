# Aimparency MCP Integration

You are working in a project managed by Aimparency.
Aimparency organizes work into **Aims** (goals/tasks) and **Phases** (time-boxed iterations).

## Core Workflow
1.  **Discovery:** Use `list_phases` to inspect the ordered phase tree. Then `list_aims` (with `phaseId` and `status='open'`) to find open tasks.
2.  **Context:** Before starting work on any aim, use `get_aim_context(aimId)` to understand the aim, its parents (why), and its children (how/dependencies).
3.  **Execution:** Implement the necessary changes.
4.  **Update:** Use `update_aim` to mark the aim as `done` and provide a comment explaining what was done.
5.  **Clarification:** When something is ambigous or unclear, set the aim's status to unclear, asking for clarification in the status comment, so that the user can provide clarification. 
6.  **Breakdown:** When aims are too complex or high level, make an effort to break them down. Do research online and think. Store evaluatable explanations (hypothesis) at the aim connection. 

## Crucial Rules
-   **ProjectPath:** Always use the provided `projectPath` (usually ending in `.bowman`).
-   **Status:** Keep aim status up-to-date (`open`, `done`, `failed`, `cancelled`). Make status updates before git committments, so that they come at once. 
-   **Atomic Changes:** If an aim is too large, break it down using `create_aim` (as sub-aims) instead of keeping it in progress for too long. There is also a prompt offered by the MCP for breaking down aims that you can use.

## Tools
-   `list_aims`, `get_aim`, `get_aim_context`
-   `create_aim`, `update_aim`, `delete_aim`
-   `list_phases`, `create_phase`
