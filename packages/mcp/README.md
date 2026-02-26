# Aimparency MCP Server

Model Context Protocol (MCP) server for Aimparency - allows LLMs to interact with aims and phases through standardized protocol.

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

1. **Backend must be running** on `ws://localhost:3001`
2. Node.js 16+ installed
3. Built MCP package (`npm run build` from this directory)

## Installation

### For Claude Code

Add this MCP server to your Claude Code configuration at `~/.claude/CLAUDE.md` or your project's `CLAUDE.md`:

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

**Note:** Use absolute paths, not relative paths!

### For Claude for Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

## Usage

### Resources (Read-Only Context)

Resources let the LLM read current state without calling functions. All resources require `?projectPath=/path/to/project` query parameter.

**Aims:**
- `aim://<uuid>?projectPath=/path` - Single aim details
- `aim://<uuid>/incoming?projectPath=/path` - Aims this aim depends on
- `aim://<uuid>/outgoing?projectPath=/path` - Aims that depend on this aim
- `aims://all?projectPath=/path` - All aims list

**Phases:**
- `phase://<uuid>?projectPath=/path` - Single phase details
- `phase://<uuid>/aims?projectPath=/path` - Aims committed to phase
- `phases://all?projectPath=/path` - All phases
- `phases://<parent-uuid>/children?projectPath=/path` - Child phases

**Project:**
- `project://meta?projectPath=/path` - Project metadata (name, color)

**Example:**
```
Read aims://all?projectPath=/home/user/my-project to see all aims
```

### Tools (Actions)

Tools allow the LLM to modify state. All tools require `projectPath` parameter.

**Aim Operations:**
- `create-aim` - Create new aim with text, status, relationships
- `update-aim` - Update aim text, status, or relationships
- `delete-aim` - Delete aim (removes from all phases)
- `addReflection` - Add structured reflection to completed aim (context, outcome, effectiveness, lesson, pattern)

**Phase Operations:**
- `create-phase` - Create new phase with name, dates, parent
- `update-phase` - Update phase properties
- `delete-phase` - Delete phase (uncommits aims, doesn't delete them)

**Relationship Operations:**
- `commit-aim-to-phase` - Add aim to phase commitments
- `remove-aim-from-phase` - Remove aim from phase

**Project Operations:**
- `update-project-meta` - Update project name and color

**Examples:**
```javascript
// Create a new aim
create-aim({
  projectPath: "/home/user/my-project",
  text: "Implement user authentication",
  status: { state: "open", comment: "" }
})

// Add reflection after completing an aim
addReflection({
  projectPath: "/home/user/my-project",
  aimId: "some-uuid",
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
- `breakdown` - Break an aim into smaller sub-aims with dependencies
- `analyze-dependencies` - Analyze aim relationships and suggest improvements
- `plan-phase` - Help plan which aims to commit to a phase
- `review-progress` - Review phase progress and suggest next actions
- `hypothesis-test` - Structure an aim as a testable hypothesis

**Example usage with Claude:**
```
Use the "breakdown" prompt with aimId=<uuid> and projectPath=/path/to/project
```

## Workflow Example: Indefinite Goal-Driven Work

The MCP server is designed to support LLMs working indefinitely on goals:

1. **Start with a big goal:**
   ```
   Create an aim for "Build recommendation engine"
   ```

2. **Break it down:**
   ```
   Use the breakdown prompt to split into sub-aims
   ```

3. **Analyze dependencies:**
   ```
   Use analyze-dependencies to understand what can be worked on now
   ```

4. **Plan a phase:**
   ```
   Create a phase for "Week 1" and use plan-phase prompt to commit aims
   ```

5. **Work and test:**
   ```
   Use hypothesis-test prompt to structure aims as testable hypotheses
   Update aim statuses as work progresses
   ```

6. **Review and iterate:**
   ```
   Use review-progress prompt to assess phase completion
   Break down blocked aims further if needed
   Repeat cycle
   ```

## Development

### Building

```bash
npm run build
```

This compiles TypeScript and makes the output executable.

### Development Mode

```bash
npm run dev
```

Watches for changes and rebuilds automatically.

### Testing

1. Start the backend server:
   ```bash
   cd packages/backend
   npm run dev
   ```

2. In another terminal, configure and restart your MCP client (Claude Code or Claude for Desktop)

3. Try commands like:
   - "List all aims in /path/to/my-project"
   - "Create a new aim for implementing authentication"
   - "Break down aim <uuid> into sub-aims"

## Troubleshooting

### MCP server not showing up

1. Check that the path in config is absolute and correct
2. Verify the build folder exists: `ls packages/mcp/build/index.js`
3. Make sure `index.js` is executable: `chmod +x packages/mcp/build/index.js`
4. Restart your MCP client completely

### Tool calls failing

1. **Check backend is running:** `curl http://localhost:3001` or check for WebSocket connection
2. **Check logs:** Backend logs will show tRPC errors
3. **Verify projectPath:** Must be absolute path to valid Aimparency project
4. **Verify UUIDs:** All aim/phase IDs must exist

### Resource reads failing

Common issue: Missing `projectPath` query parameter

**Wrong:**
```
aim://some-uuid
```

**Correct:**
```
aim://some-uuid?projectPath=/absolute/path/to/project
```

### Connection errors

Error: `Failed to connect to backend`
- Backend not running on `ws://localhost:3001`
- Start backend: `cd packages/backend && npm run dev`

## Future Enhancements

- **tRPC Subscriptions:** Real-time updates when web UI or other clients modify data
- **Multiple Backend Support:** Connect to different backend instances
- **Batch Operations:** Bulk create/update aims for efficiency
- **Search/Filter:** Advanced resource queries with filters

## License

ISC
