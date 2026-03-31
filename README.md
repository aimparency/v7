# Aimparency

Aimparency is a local-first planning and coordination tool that lives next to real repositories.

It runs as a browser app on your machine, stores project state in a `.bowman` directory inside the repo or workspace you point it at, and can start local agent sessions through the broker.

The longer-term vision is bigger than a single repo planner. Aimparency is intended to become a planning layer for open source projects in general, with project-local state by default and cross-repository references over time. That points toward a global planning graph for the open source software landscape, while still keeping ownership and control inside ordinary repositories.

Git is a large part of why this model is attractive:

- permissions come from the repositories and workflows teams already use
- version control comes for free because aims, phases, and code live in the same history
- code changes and aim/status updates can be committed together, making it much easier to see what changed and why
- that paired history may also become useful training material for intent, hypothesis, planning, and execution loops in future LLM systems

## What This Repo Contains

- `packages/frontend`: main UI
- `packages/backend`: tRPC backend and project-state persistence
- `packages/wrapped-agents/broker`: session broker for Claude, Gemini, and Codex workers
- `packages/mcp`: optional MCP server
- `packages/voice-bridge`: optional voice integration
- `packages/shared`: shared types and logic

## Prerequisites

- Node.js 20+
- npm

Optional:

- Claude CLI for Claude-backed sessions
- Gemini tooling for Gemini-backed sessions
- Codex tooling for Codex-backed sessions

The core app still starts without those agent CLIs. They are only needed when you want to launch that session type.

## Quickstart

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:4000
```

`4000` is the default frontend port in a fresh checkout. If you want custom ports, copy `.env.example` to `.env` and override them there.

`npm run dev` starts the core local stack: frontend, backend, broker, and wrapped-agent session servers.

If you need optional integrations too, use:

```bash
npm run dev:full
```

That also starts the dev-only broker inspector, MCP server, and voice bridge.

Voice remains opt-in in the browser UI. To expose it in launcher-based runs, set `AIMPARENCY_ENABLE_VOICE=true` before `npm run dev` or `npm run start`. If you run the frontend directly, use `VITE_ENABLE_VOICE=true`.

For a lighter build-mode local stack:

```bash
npm run start
```

If you already built everything and want to skip rebuilding:

```bash
npm run start:fast
```

If you want to build without starting the stack:

```bash
npm run build
```

For optional integrations too:

```bash
npm run build:all
```

The main visible URL is the frontend, usually `http://localhost:4000`. Backend, broker, and session ports stay in the background. The launcher prints the resolved ports at startup and writes them to `packages/frontend/public/runtime-config.json`.

To validate the local launcher and runtime-config fallback behavior without starting the full stack, run:

```bash
npm run validate:local-runtime
```

That script checks both default-port and occupied-port cases and verifies that runtime config stays internally consistent.

## Local Workflow

Point Aimparency at a local repo or workspace. In the UI, enter the project base folder path, not the `.bowman` path itself.

Example:

- repo root: `/home/user/my-repo`
- Aimparency data directory inside it: `/home/user/my-repo/.bowman`

The backend normalizes the path and creates `.bowman` if needed. That directory becomes the local storage root for aims, phases, metadata, and generated search artifacts.

This keeps the workflow git-friendly:

- Aimparency state lives next to the code it describes
- the checked-in shape is plain files
- generated vector/cache artifacts are ignored inside `.bowman/.gitignore`

## `.bowman` Layout

Aimparency writes project data into a `.bowman` directory in the target repo or workspace.

Typical structure:

```text
my-project/
  .bowman/
    aims/
    archived-aims/
    phases/
    meta.json
    .gitignore
    vectors.json
    cache.db
    semantic-graph.json
```

What each part is for:

- `aims/`: active aims stored as JSON files
- `archived-aims/`: archived aims stored as JSON files
- `phases/`: phase definitions stored as JSON files
- `meta.json`: project name, color, and available statuses
- `.gitignore`: generated `.bowman` artifacts that should not be committed
- `vectors.json`, `cache.db`, `semantic-graph.json`: generated search/cache data

## Git Workflow

Aimparency is designed so the important project state can live next to the code it describes.

In the intended workflow, code edits and planning updates travel together. A commit can contain both the implementation and the corresponding aim changes, status changes, comments, or reflections. That gives you a much clearer history of intent, execution, and outcome than code diffs alone.

In normal use, these files are user-authored project state and are reasonable to commit:

- `.bowman/aims/*.json`
- `.bowman/archived-aims/*.json`
- `.bowman/phases/*.json`
- `.bowman/meta.json`
- `.bowman/.gitignore`

These files are generated runtime/search artifacts and should usually stay uncommitted:

- `.bowman/vectors.json`
- `.bowman/cache.db`
- `.bowman/semantic-graph.json`

The backend keeps those generated artifacts listed in `.bowman/.gitignore` automatically.

One exception to the “everything stays in `.bowman`” rule is agent-instruction injection. If you use that feature, Aimparency may also update repo-root agent config files such as:

- `CLAUDE.md`
- `.gemini/GEMINI.md`
- `.cursorrules`

Those files are normal repository files, not generated cache output. Review and commit them intentionally if you want the injected instructions to travel with the repo.

If you use one Aimparency instance with multiple repos or workspaces, each target gets its own separate `.bowman` directory. Aimparency does not merge those project states together on disk.

## Optional Integrations

- MCP: `packages/mcp/README.md`
- Voice UI/runtime flag: set `AIMPARENCY_ENABLE_VOICE=true` for launcher-based runs or `VITE_ENABLE_VOICE=true` when running the frontend directly
- Frontend package notes: `packages/frontend/README.md`
- Backend package notes: `packages/backend/README.md`
- Broker package notes: `packages/wrapped-agents/broker/README.md`
- Transitional embedder notes: `packages/embedder/README.md`
- Experimental mobile notes: `packages/mobile/README.md`

## Troubleshooting

Common local startup failures are usually one of these:

- `npm run start` shows the frontend but the UI cannot reach the backend or broker:
  Check the terminal output from the launcher. It should print the frontend URL and the resolved backend and broker ports. If a background service crashed during startup, fix that service first and rerun `npm run start`.
- Build-mode startup fails with missing `dist/` output:
  Run `npm run build` once from the repo root, then retry `npm run start`. That builds only the core local runtime packages. If you are debugging MCP or voice specifically, use `npm run build:all`.
- The browser keeps trying to connect to the wrong host or port:
  Remove `packages/frontend/public/runtime-config.json`, rerun the launcher, and reload the page. That file is generated runtime state and should not be committed.
- You want to verify the launcher's port fallback behavior directly:
  Run `npm run validate:local-runtime`. It performs a dry-run validation of runtime-config generation for both free and occupied preferred ports.
- A wrapped-agent session type does not start:
  The core UI can run without Claude, Gemini, or Codex CLIs, but launching that specific session type still requires the corresponding local tooling to be installed and working on your machine.
- Semantic search looks stale or unexpectedly weak:
  Delete `.bowman/vectors.json` and `.bowman/semantic-graph.json`, then rerun `project.buildSearchIndex` or reload the project so the backend regenerates local embeddings.

## Repository Notes

- `subdev/` contains related experiments and side projects; it is not part of the main onboarding path. See `subdev/README.md`.
- `packages/wrapped-agents/client` is a dev-only broker inspector, not the main product UI.
- `packages/embedder` is a legacy Python implementation kept for reference and experimentation; the default backend now generates embeddings in-process.
- `packages/mobile` is an experimental Android voice client, not part of the main local-first release path.
- Top-level folders such as `education/`, `ideas/`, `thoughts/`, `q-and-a/`, `real-world-entry/`, and `scheduled-claude/` contain notes, experiments, or archived exploration rather than the core shipped product.
