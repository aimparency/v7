# Aimparency MCP Server

Model Context Protocol (MCP) server for Aimparency. It lets external LLM tooling interact with ideas, phases, project metadata, and reflections through the local Aimparency backend.

This package is an optional integration. The main open source product story is still:

1. run Aimparency locally
2. open a local repo or workspace in the browser UI
3. optionally connect an MCP client to that same local backend

## Architecture

The MCP server acts as a **tRPC client** to the existing Aimparency backend:

```
LLM (Claude) → MCP Server (stdio) → tRPC Client → Backend Server (WS) → Files
```

This architecture allows:
- Clean separation of concerns
- Future-ready for tRPC subscriptions (live updates across web + MCP clients)
- Single source of truth (all mutations go through backend)
- Backend doesn't need to understand MCP protocol

## Prerequisites

1. Aimparency backend running locally
2. Node.js 20+ installed
3. Built MCP package: `npm run build -w mcp`

By default the MCP server connects to the local backend on `ws://localhost:3001`. If you run Aimparency on different ports, set the relevant environment variables before launching the MCP server.

## Installation

### For Claude Code

Build the package first:

```bash
npm run build -w mcp
```

Then add this MCP server to your Claude Code configuration:

```json
{
  "mcpServers": {
    "aimparency": {
      "command": "node",
      "args": [
        "/absolute/path/to/aimparency/v7/packages/mcp/build/index.js"
      ]
    }
  }
}
```

Use an absolute path, not a relative one.

### For Claude for Desktop

Add the same command entry to your Claude Desktop configuration:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\\Claude\\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "aimparency": {
      "command": "node",
      "args": [
        "/absolute/path/to/aimparency/v7/packages/mcp/build/index.js"
      ]
    }
  }
}
```

Restart Claude after updating the configuration.

## Choosing `projectPath`

Aimparency stores project state inside a `.bowman` directory, but MCP calls can usually use either of these absolute paths:

- the repo or workspace root, for example `/home/user/my-project`
- the explicit Aimparency directory, for example `/home/user/my-project/.bowman`

The backend normalizes repo-root paths to the matching `.bowman` directory.

## Usage

### Resources (Read-Only Context)

Resources let the LLM read current state without calling functions. All resources require `?projectPath=/path/to/project` query parameter.

**Ideas:**
- `idea://<uuid>?projectPath=/path` - Single idea details
- `idea://<uuid>/incoming?projectPath=/path` - Ideas this idea depends on
- `idea://<uuid>/outgoing?projectPath=/path` - Ideas that depend on this idea
- `ideas://all?projectPath=/path` - All ideas list

**Phases:**
- `phase://<uuid>?projectPath=/path` - Single phase details
- `phase://<uuid>/ideas?projectPath=/path` - Ideas committed to phase
- `phases://all?projectPath=/path` - All phases
- `phases://<parent-uuid>/children?projectPath=/path` - Child phases

**Project:**
- `project://meta?projectPath=/path` - Project metadata (name, color)

**Example:**
```
Read ideas://all?projectPath=/home/user/my-project to see all ideas
```

### Tools (Actions)

Tools allow the LLM to modify state. All tools require `projectPath` parameter.

**Idea Operations:**
- `create-idea` - Create new idea with text, status, relationships
- `update-idea` - Update idea text, status, or relationships
- `delete-idea` - Delete idea (removes from all phases)
- `addReflection` - Add structured reflection to completed idea (context, outcome, effectiveness, lesson, pattern)

**Phase Operations:**
- `create-phase` - Create new phase with name, dates, parent
- `update-phase` - Update phase properties
- `delete-phase` - Delete phase (uncommits ideas, doesn't delete them)

**Relationship Operations:**
- `commit-idea-to-phase` - Add idea to phase commitments
- `remove-idea-from-phase` - Remove idea from phase

**Project Operations:**
- `update-project-meta` - Update project name and color

**Examples:**
```javascript
// Create a new idea
create-idea({
  projectPath: "/home/user/my-project",
  text: "Implement user authentication",
  status: { state: "open", comment: "" }
})

// Add reflection after completing an idea
addReflection({
  projectPath: "/home/user/my-project",
  ideaId: "some-uuid",
  reflection: {
    context: "Implemented JWT authentication with refresh tokens",
    outcome: "Successfully deployed, all tests passing",
    effectiveness: "Approach worked well, though refresh token rotation was tricky",
    lesson: "Should have reviewed OAuth 2.0 best practices before starting",
    pattern: "Similar to previous API authentication work in project X"
  }
})
```

### Prompts (LLM Workflows)

Prompts are pre-built workflows that guide the LLM through complex tasks:

**Available Prompts:**
- `dream` - Simulate possible futures, find distant synergies and tensions, optionally research reality, and return falsifiable hypotheses plus reversible experiments
- `breakdown` - Break an idea into smaller sub-ideas with dependencies
- `analyze-dependencies` - Analyze idea relationships and suggest improvements
- `plan-phase` - Help plan which ideas to commit to a phase
- `review-progress` - Review phase progress and suggest next actions
- `hypothesis-test` - Structure an idea as a testable hypothesis

**Example usage with Claude:**
```
Use the "breakdown" prompt with ideaId=<uuid> and projectPath=/path/to/project
```

## Workflow Example: Indefinite Goal-Driven Work

The MCP server is designed to support LLMs working indefinitely on goals:

1. **Start with a big goal:**
   ```
   Create an idea for "Build recommendation engine"
   ```

2. **Break it down:**
   ```
   Use the breakdown prompt to split into sub-ideas
   ```

3. **Analyze dependencies:**
   ```
   Use analyze-dependencies to understand what can be worked on now
   ```

4. **Plan a phase:**
   ```
   Create a phase for "Week 1" and use plan-phase prompt to commit ideas
   ```

5. **Work and test:**
   ```
   Use hypothesis-test prompt to structure ideas as testable hypotheses
   Update idea statuses as work progresses
   ```

6. **Review and iterate:**
   ```
   Use review-progress prompt to assess phase completion
   Break down blocked ideas further if needed
   Repeat cycle
   ```

## Development

### Building

```bash
npm run build -w mcp
```

This compiles TypeScript into `packages/mcp/build` and makes the entrypoint executable.

### Development Mode

```bash
npm run dev -w mcp
```

Watches for changes and rebuilds automatically.

### Testing

1. Start Aimparency locally, usually from the repo root:
   ```bash
   npm run dev
   ```

2. In another terminal, build the MCP package if needed:
   ```bash
   npm run build -w mcp
   ```

3. Configure and restart your MCP client (Claude Code or Claude for Desktop)

4. Try commands like:
   - "List all ideas in /path/to/my-project"
   - "Create a new idea for implementing authentication"
   - "Break down idea <uuid> into sub-ideas"

## Troubleshooting

### MCP server not showing up

1. Check that the path in config is absolute and correct
2. Verify the build output exists: `ls packages/mcp/build/index.js`
3. Rebuild the package: `npm run build -w mcp`
4. Restart your MCP client completely

### Tool calls failing

1. **Check backend is running:** `npm run dev` or `npm run start` from the repo root
2. **Check logs:** Backend logs will show tRPC errors
3. **Verify projectPath:** Must be an absolute path to a repo/workspace root or its `.bowman` directory
4. **Verify UUIDs:** All idea/phase IDs must exist

### Resource reads failing

Common issue: Missing `projectPath` query parameter

**Wrong:**
```
idea://some-uuid
```

**Correct:**
```
idea://some-uuid?projectPath=/absolute/path/to/project
```

### Connection errors

Error: `Failed to connect to backend`
- Backend not running on the expected local websocket port
- Start Aimparency locally: `npm run dev` or `npm run start`
- If you changed backend ports, launch the MCP server with matching environment variables

## Future Enhancements

- **tRPC Subscriptions:** Real-time updates when web UI or other clients modify data
- **Multiple Backend Support:** Connect to different backend instances
- **Batch Operations:** Bulk create/update ideas for efficiency
- **Search/Filter:** Advanced resource queries with filters

## License

ISC
