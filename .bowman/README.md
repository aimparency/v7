# .bowman

This repository's ideas: aims, how they support each other, and phases.
Plain JSON, versioned by git, made with [Aimparency](https://github.com/aimparency/v7).

- **View and edit:** clone Aimparency and run `pnpm dev <path of this repository>`,
  or view it read-only with `http://localhost:4000/?repo=<git url of this repository>`.
- **Agents** work on it through Aimparency's MCP server.
- **By hand** works too, but Aimparency migrates the files between data model
  versions ([format](https://github.com/aimparency/v7/tree/main/protocol)).
- `runtime/` and the other gitignored files are local to one machine.
