# Aimparency

Aimparency is an open-source, local-first interface for communicating human intention to AI systems. It runs as a browser app on your machine and keeps a graph of ideas in a `.bowman` directory inside the repository it describes, versioned by git like the code.

## What it is for

Aimparency pursues two aims.

1. **An interface for human intention.** People state what they want as ideas. A connection says how one idea serves another and carries a hypothesis that can turn out wrong. Value flows down the graph, so priorities follow from what people care about rather than from a schedule. AI systems read the graph to know what matters and why. They propose new ideas, which wait for a human to accept them, and they report back with evidence. The human stays the final authority.
2. **An open-ended experiment.** Let AI venture into the future in an endless loop: pick the most valuable idea, break it down, work on it, verify the result, reflect on whether the hypotheses held, and form new hypotheses and ideas of its own. The graph is the loop's memory and the record of the experiment.

Git is a large part of why this works:

- permissions come from the repositories and workflows people already use
- version control comes for free, because ideas, phases and code share one history
- code changes and the idea updates behind them can be committed together, so the history shows what changed and why
- that paired history of intent, hypothesis and outcome may become training material for future AI systems

## Philosophy

- freedom means being able to move along ideas
- deadlines are chances to make the current state presentable, not the ultimate measure of value
- speed matters more than time: the point is to spend effort on the things you most want to do
- priority matters more than rigid schedules
- all ideas are optional, and priorities can shift

## Quickstart

You need Node.js 22.13+ and git; `corepack enable` provides the pnpm version pinned in `package.json`.

```bash
pnpm install
pnpm dev
```

Then open `http://localhost:4000` and enter the path of this repository (the folder, not its `.bowman`). Its graph is not sample data: it holds the goals, hypotheses and reflections that shaped Aimparency itself.

To work on your own repository, pass its path: `pnpm dev ~/code/my-repo` prints a link that opens it directly and creates its `.bowman` on first open. A Git URL instead of a path opens that repository read-only.

Agent sessions run the coding-agent CLI you pick for them (Claude Code, Codex, Gemini, Grok, Agy). Install only the ones you want to use; the app runs without any of them.

## Run Modes

| Command | What it does |
|---|---|
| `pnpm dev` | Frontend, backend and broker from source, no build step; moves to free ports if the defaults are taken |
| `pnpm dev:full` | Also the MCP server over SSE, the broker inspector and the voice bridge |
| `pnpm dev:host` | Like `dev`, but reachable from `LAN_BIND_HOST` (or the Tailscale IP) instead of loopback only |
| `pnpm start` | Builds, then runs the built bundles; uses exactly the configured ports (`--port <n>` for one run) |
| `pnpm start:fast` | `start` without rebuilding |
| `pnpm build` / `pnpm build:optional` | Build the core packages / also the MCP server and voice bridge |

Ports and other settings go in `.env` (see `.env.example`). The first `pnpm start` in a terminal asks which repository to open and whether to host it for other people, and saves the answers there; `pnpm start --setup` asks again. Voice is opt-in: set `AIMPARENCY_ENABLE_VOICE=true`.

Backend, broker and agent sessions listen on `127.0.0.1` only and answer only pages served from this machine, since they can start agents. The launcher prints the resolved ports and writes them to `packages/frontend/public/runtime-config.json`. `pnpm validate:local-runtime` checks the port handling without starting the stack.

## The Loop

The loop is the second aim in code: a model-agnostic harness in `packages/loop-worker` that works through the graph on its own. Each cycle orients on the highest-priority idea, decomposes it if it is too large, executes it if it is a leaf, has a model from a different family verify the claimed result, writes reflections on the connections it served, and records the cost.

- Models per role (planner, executor, verifier, reflector) are set in `.bowman/runtime/loops.json`; providers are NVIDIA, OpenRouter, Anthropic and any OpenAI-compatible endpoint.
- API keys go in `.bowman/secrets.json` (gitignored), e.g. `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`.
- Stages, budgets and the executor backend (built-in tools, or Claude Code / Codex as a headless CLI) are set in `.bowman/harness.json`, which is versioned with the graph.
- The built-in file search uses ripgrep (`rg`).

Start and watch loops from the Loop panel in the UI.

## Agents and MCP

Coding agents read and change the graph through the Aimparency MCP server: ideas, priorities, context paths, hypotheses and reflections, phases. See [`packages/mcp/README.md`](packages/mcp/README.md) for connecting Claude Code, Codex or another MCP client.

## `.bowman` Layout

```text
my-project/
  .bowman/
    ideas/            active ideas, one JSON file each
    archived-ideas/   archived ideas
    phases/           phases
    meta.json         project name, color, statuses, data model version, linked repositories
    harness.json      loop harness configuration (optional)
    memory/           session notes of wrapped agents
    README.md         a short note for people who find the folder
    .gitignore        what stays out of git (kept up to date by the backend)
    secrets.json      API keys (gitignored)
    runtime/          machine-local state: loops, accounts, activity (gitignored)
    cache/            embeddings, search index, values; safe to delete (gitignored)
```

The format is specified with JSON Schemas in [`protocol/`](protocol/README.md), so other tools can read and write it. Check a project with `pnpm validate:bowman <path>`. Each repository gets its own `.bowman`; Aimparency never merges projects on disk.

## Git Workflow

Ideas, phases and `meta.json` are plain files meant to be committed, ideally in the same commit as the code they describe. A commit that implements an idea names its id (the first 8 characters), so the idea shows the commits that realized it.

One feature writes outside `.bowman`: injecting agent instructions updates `CLAUDE.md`, `.gemini/GEMINI.md` and `.cursorrules` at the repository root. Review and commit those like any other file.

## Starting From Existing Issues

To begin with what a project already tracks, import its open GitHub issues: they become ideas under one parent idea, and re-running only adds new ones. Agents can do this with the MCP tool `import_github_issues` (`owner/repo` or a github.com URL; set `GITHUB_TOKEN` for private repositories). Specs written for coding agents work the same way: `import_spec_tasks` turns the `tasks.md` checklists of GitHub spec-kit or spec-workflow-mcp into one parent idea per spec with its tasks as children, checked tasks as implemented; re-running it adds new tasks and moves newly ticked ones forward.

## Viewing Someone Else's Graph

Paste a Git URL into the project picker, or open a link like

```text
http://localhost:4000/?repo=https://github.com/aimparency/v7.git
```

Aimparency clones only that repository's `.bowman` into `~/.cache/aimparency/repos/` and opens it read-only: you can browse everything, edits are refused, and reopening fetches the latest commit. Maintainers can put such a link in their README; viewers still run Aimparency locally.

## Hosting It for a Group

One server can host a project's graph for a whole group: anyone may read it,
people with an account may edit it, and admins manage the accounts. On the
server (Node.js 22.13+ and git; an https clone needs no GitHub account):

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
`/mcp/sse`. Loops stay off on a hosted instance, and no other project can be
opened. Wrapped agents (the watchdog) are off too unless you
answer yes to "Let admins run wrapped agents?" (`AIMPARENCY_AGENTS=true`):
then admins, and only admins, get them in the UI. The broker and the agent
sessions listen on `127.0.0.1`; the one port lets a request through to them
only with an admin's login and from the instance's own origin. The agents'
own Aimparency MCP edits the graph as the account `wrapped-agents` (write),
whose token is replaced on every start; remove that account to make them
read-only.

- **Accounts.** Admins add people in the UI (header: Accounts), or on the
  server with `pnpm accounts add <name> <read|write|admin>`,
  `pnpm accounts role|password|remove <name>` and `pnpm accounts list`. Accounts
  live in the project's `.bowman/runtime/accounts.json` (gitignored); passwords
  are stored as scrypt hashes.
- **Roles.** Reading needs no account. `write` edits ideas and phases.
  `admin` also manages accounts, project settings and commits, and holds the
  wrapped-agent shell when agents are on: a shell on the server as the user Aimparency
  runs as, with read access to whatever that user can read (`/etc`, other
  files) and every secret in Aimparency's `.env`. Make admin only people you
  would give an SSH login; the setup, `pnpm accounts` and the Accounts dialog
  warn about this.
- **Commits.** Edits change the files in the served repository; someone with
  push access commits and pushes them, and that git account answers for every
  account it lets in.
- **Pulling.** Every 5 minutes the instance fast-forwards to what was pushed
  upstream, and open browsers update. It waits while the served `.bowman` has
  uncommitted edits and never merges diverged history (the log says why it is
  not pulling). `AIMPARENCY_PULL_SECONDS` sets the interval; `0` turns it off.
  A private repository needs fetch credentials for the server's user.
- **MCP.** A logged-in user's "MCP link" (in the header) connects an MCP client
  as that account. It contains a token, so treat it like a password. Without a
  token the MCP can only read.

To keep it running, a systemd unit such as `/etc/systemd/system/aimparency.service`
(adjust user and path; `pnpm` must be on systemd's PATH, check with `which pnpm`).
Without a terminal `pnpm start` asks nothing and uses the saved answers; it
rebuilds on each start, `pnpm start --no-build` skips that:

```ini
[Unit]
Description=Aimparency (hosted)
After=network-online.target
Wants=network-online.target

[Service]
User=aimparency
WorkingDirectory=/srv/aimparency/aimparency
ExecStart=/usr/bin/env pnpm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then `sudo systemctl enable --now aimparency` and follow it with `journalctl -u aimparency -f`.

Behind nginx with TLS, one location is enough; the rate limit keeps a single
client from flooding a public instance:

```nginx
# in the http block
limit_req_zone $binary_remote_addr zone=aimparency:10m rate=20r/s;

location / {
    limit_req zone=aimparency burst=200 nodelay;
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme; # the agents' login cookie gets Secure
    proxy_buffering off;   # MCP streams server-sent events
    proxy_read_timeout 1d; # keeps idle WebSocket and MCP connections open
}
```

## Repository Layout

- `packages/frontend`: the UI
- `packages/backend`: tRPC backend and `.bowman` persistence
- `packages/shared`: types, the value model and the data model migrations
- `packages/loop-worker`: the loop harness
- `packages/agent-tools`: graph and coding tools the loop's models use
- `packages/mcp`: the MCP server
- `packages/wrapped-agents`: the broker and one session package per agent CLI; `client` is a dev-only broker inspector
- `packages/voice-bridge`: optional voice integration
- `packages/mobile`: experimental Android voice client
- `packages/real-world`: experimental agent that acts on prioritized ideas through external tools (Composio)
- `protocol/`: the `.bowman` format specification

Other top-level folders (`meta/`, `math/`, `education/`, `ideas/`, `q-and-a/`, `sketches/`) hold notes and explorations, not the product. Package details are in each package's README.

## Troubleshooting

- **The UI cannot reach the backend or broker.** The launcher prints the frontend URL and the resolved backend and broker ports. If a service crashed during startup, fix it and start again.
- **`pnpm start` fails on missing `dist/` output.** Run `pnpm build` once, or `pnpm build:optional` when debugging the MCP server or voice.
- **The browser connects to the wrong host or port.** Delete `packages/frontend/public/runtime-config.json`, rerun the launcher and reload the page. That file is generated and not committed.
- **An agent session type does not start.** That session type needs its CLI installed and working on your machine.
- **Semantic search looks stale or weak.** Delete `.bowman/cache/` and reopen the project; the backend regenerates the embeddings.

## License

ISC, see [LICENSE](LICENSE).
