# Aimparency

> OpenAI Build Week 2026: see [BUILD_WEEK_2026.md](BUILD_WEEK_2026.md) for the
> Developer Tools entry, the exact hackathon extension, and its verification
> path. This project is not affiliated with or endorsed by OpenAI.

Aimparency is a local-first tool for cartographing ideas next to real repositories.

It runs as a browser app on your machine, stores project state in a `.bowman` directory inside the repo or workspace you point it at, and can start local agent sessions through the broker. The current data model still uses the word `idea` in many places, but the broader point is optional ideas: things people or agents may want to realize, explore, defer, split, merge, or abandon.

The longer-term vision is bigger than a single repo planner. Aimparency is intended to become a graph for breaking ideas down into realizable steps, with project-local state by default and cross-repository references over time. That can grow from software planning into a general interface for mapping how complex projects get realized, while still keeping ownership and control inside ordinary repositories.

Git is a large part of why this model is attractive:

- permissions come from the repositories and workflows teams already use
- version control comes for free because ideas, ideas, phases, and code can live in the same history
- code changes and graph/status updates can be committed together, making it much easier to see what changed and why
- that paired history may also become useful training material for intent, hypothesis, planning, and execution loops in future LLM systems

## Direction

Aimparency is built around three possible long-term outcomes for AI integration:

1. People use AI to realize their ideas, including large physical or organizational projects. The graph exists to break ideas into steps that can actually be carried out.
2. AI develops greater autonomy, forms its own ideas and hypotheses, and uses the graph as part of its own planning and execution loop.
3. AI learns to read the needs of human individuals and help realize them, as long as those paths do not conflict too heavily with other people's ideas.

In that sense, the graph is not only for tasks. It is a coordination surface between human intention, machine planning, and the real constraints of the world.

## Philosophy

- freedom means being able to move along ideas
- deadlines are chances to make the current state presentable, not the ultimate measure of value
- speed matters more than time: the point is to spend effort on the things you most want to do
- priority matters more than rigid schedules
- all ideas are optional, and priorities can shift

## What This Repo Contains

- `packages/frontend`: main UI
- `packages/backend`: tRPC backend and project-state persistence
- `packages/wrapped-agents/broker`: session broker for Claude, Gemini, and Codex workers
- `packages/mcp`: optional MCP server
- `packages/voice-bridge`: optional voice integration
- `packages/shared`: shared types and logic

## Prerequisites

- Node.js 20+
- pnpm (`corepack enable` picks the version pinned in `package.json`)

Optional:

- [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) for the agent coding tools' file search
- Claude CLI for Claude-backed sessions
- Gemini tooling for Gemini-backed sessions
- Codex tooling for Codex-backed sessions

The core app still starts without those agent CLIs. They are only needed when you want to launch that session type.

## Quickstart

```bash
pnpm install
pnpm dev
```

Then open:

```text
http://localhost:4000
```

For the best first look, enter the path of this cloned `v7` repository and
explore its own graph. The graph is not sample data: it contains the goals,
dependencies, implementation ideas, reflections, and Build Week submission path
that shaped the repository itself.

To work on your own repository, pass its path: `pnpm dev ~/code/my-repo`
prints a link that opens it directly (a `.bowman` directory is created there on
first open). A Git URL instead of a path opens that repository read-only.

`4000` is the default frontend port in a fresh checkout. If you want custom ports, copy `.env.example` to `.env` and override them there.

`pnpm dev` starts the core local stack from source (no build step): frontend, backend, and broker. The broker spawns wrapped-agent sessions on demand. `pnpm start` builds bundles and runs those instead.

If you need optional integrations too, use:

```bash
pnpm dev:full
```

Use `dev:full` when trying the complete agent/MCP workflow demonstrated by the
Build Week entry. The app remains self-hosted and opens on
`http://localhost:4000` by default.

That also starts the dev-only broker inspector, MCP server, and voice bridge.

Voice remains opt-in in the browser UI. To expose it in launcher-based runs, set `AIMPARENCY_ENABLE_VOICE=true` before `pnpm dev` or `pnpm start`. If you run the frontend directly, use `VITE_ENABLE_VOICE=true`.

For a lighter build-mode local stack:

```bash
pnpm start
```

The first `pnpm start` in a terminal asks which repository to open and whether
other people should reach it (see [Hosting It for a Group](#hosting-it-for-a-group));
the answers go to `.env`, and `pnpm start --setup` asks again. `pnpm start` uses
exactly the configured ports and stops if one is taken; `--port <n>` picks
another frontend port for one run. `pnpm dev` still moves to free ports.

If you already built everything and want to skip rebuilding:

```bash
pnpm start:fast
```

If you want to build without starting the stack:

```bash
pnpm build
```

For optional integrations too:

```bash
pnpm build:optional
```

The main visible URL is the frontend, usually `http://localhost:4000`. Backend, broker, and session ports stay in the background. The launcher prints the resolved ports at startup and writes them to `packages/frontend/public/runtime-config.json`.

To validate the local launcher and runtime-config fallback behavior without starting the full stack, run:

```bash
pnpm validate:local-runtime
```

That script checks that `dev` moves to free ports, that `start` refuses occupied ones, and the hosted mode's single port.

## Local Workflow

Point Aimparency at a local repo or workspace. In the UI, enter the project base folder path, not the `.bowman` path itself.

Example:

- repo root: `/home/user/my-repo`
- Aimparency data directory inside it: `/home/user/my-repo/.bowman`

The backend normalizes the path and creates `.bowman` if needed. That directory becomes the local storage root for ideas represented as ideas, phases, metadata, and generated search artifacts.

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
    ideas/
    archived-ideas/
    phases/
    meta.json
    .gitignore
    vectors.json
    cache.db
    semantic-graph.json
```

What each part is for:

- `ideas/`: active ideas stored as JSON files
- `archived-ideas/`: archived ideas stored as JSON files
- `phases/`: phase definitions stored as JSON files
- `meta.json`: project name, color, and available statuses
- `.gitignore`: generated `.bowman` artifacts that should not be committed
- `vectors.json`, `cache.db`, `semantic-graph.json`: generated search/cache data

The format is specified in [`protocol/`](protocol/README.md) with JSON Schemas, so other tools can read and write it. Check a project with `pnpm validate:bowman <path>`.

## Starting From Existing Issues

To begin with what a project already tracks, import its open GitHub issues: they become ideas under one parent idea, and re-running only adds new ones. Agents can do this with the MCP tool `import_github_issues` (`owner/repo` or a github.com URL; set `GITHUB_TOKEN` for private repositories).

## Viewing Someone Else's Graph

Paste a Git URL into the project picker, or open a link like

```text
http://localhost:4000/?repo=https://github.com/aimparency/v7.git
```

Aimparency clones only that repository's `.bowman` into `~/.cache/aimparency/repos/` and opens it read-only: you can browse everything, edits are refused, and reopening fetches the latest commit. Maintainers can put such a link in their README; viewers still run Aimparency locally.

## Hosting It for a Group

One server can host a project's graph for a whole group: anyone may read it,
people with an account may edit it, and admins manage the accounts. On the
server (Node.js 20+ and git; an https clone needs no GitHub account):

```bash
git clone https://github.com/aimparency/v7.git aimparency
cd aimparency
corepack enable
pnpm install
pnpm start
```

`pnpm start` asks:

1. the repository to serve: a path, or a Git URL that it clones next to `aimparency/`;
2. whether to host it for other people: answer yes;
3. the port (default 4000) and the address to listen on (`127.0.0.1` behind nginx);
4. the first admin's name and password.

From then on `pnpm start` (for example from a systemd unit) serves that one
project on that one port: the UI, the API under `/trpc`, and an MCP server under
`/mcp/sse`. Agents, loops and the watchdog stay off on a hosted instance, and
nothing outside the project can be opened.

- **Accounts.** Admins add people in the UI (header: Accounts), or on the
  server with `pnpm accounts add <name> <read|write|admin>`,
  `pnpm accounts role|password|remove <name>` and `pnpm accounts list`. Accounts
  live in the project's `.bowman/runtime/accounts.json` (gitignored); passwords
  are stored as scrypt hashes.
- **Roles.** Reading needs no account. `write` edits ideas and phases.
  `admin` also manages accounts, project settings and commits.
- **Commits.** Edits change the files in the served repository; someone with
  push access commits and pushes them, and that git account answers for every
  account it lets in.
- **MCP.** A logged-in user's "MCP link" (in the header) connects an MCP client
  as that account. It contains a token, so treat it like a password. Without a
  token the MCP can only read.

Behind nginx with TLS, one location is enough:

```nginx
location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_buffering off;   # MCP streams server-sent events
    proxy_read_timeout 1d; # keeps idle WebSocket and MCP connections open
}
```

## Git Workflow

Aimparency is designed so the important project state can live next to the code it describes.

In the intended workflow, code edits and planning updates travel together. A commit can contain both the implementation and the corresponding idea changes, status changes, comments, or reflections. That gives you a much clearer history of intent, execution, and outcome than code diffs alone.

In normal use, these files are user-authored project state and are reasonable to commit:

- `.bowman/ideas/*.json`
- `.bowman/archived-ideas/*.json`
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
- Experimental mobile notes: `packages/mobile/README.md`

## Troubleshooting

Common local startup failures are usually one of these:

- `pnpm start` shows the frontend but the UI cannot reach the backend or broker:
  Check the terminal output from the launcher. It should print the frontend URL and the resolved backend and broker ports. If a background service crashed during startup, fix that service first and rerun `pnpm start`.
- Build-mode startup fails with missing `dist/` output:
  Run `pnpm build` once from the repo root, then retry `pnpm start`. That builds only the core local runtime packages. If you are debugging MCP or voice specifically, use `pnpm build:optional`.
- The browser keeps trying to connect to the wrong host or port:
  Remove `packages/frontend/public/runtime-config.json`, rerun the launcher, and reload the page. That file is generated runtime state and should not be committed.
- You want to verify the launcher's port fallback behavior directly:
  Run `pnpm validate:local-runtime`. It performs a dry-run validation of runtime-config generation for both free and occupied preferred ports.
- A wrapped-agent session type does not start:
  The core UI can run without Claude, Gemini, or Codex CLIs, but launching that specific session type still requires the corresponding local tooling to be installed and working on your machine.
- Semantic search looks stale or unexpectedly weak:
  Delete `.bowman/vectors.json` and `.bowman/semantic-graph.json`, then rerun `project.buildSearchIndex` or reload the project so the backend regenerates local embeddings.

## Repository Notes

- `subdev/` contains related experiments and side projects; it is not part of the main onboarding path. See `subdev/README.md`.
- `packages/wrapped-agents/client` is a dev-only broker inspector, not the main product UI.
- `packages/mobile` is an experimental Android voice client, not part of the main local-first release path.
- Top-level folders such as `education/`, `ideas/`, `thoughts/`, `q-and-a/`, `real-world-entry/`, and `scheduled-claude/` contain notes, experiments, or archived exploration rather than the core shipped product.
