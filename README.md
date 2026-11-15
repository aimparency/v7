# Aimparency

Aimparency is an open-source, local-first interface for communicating human intention to AI systems. It runs as a browser app on your machine and keeps a graph of ideas in a `.bowman` directory inside the repository it describes, versioned by git like the code.

## What it is for

Aimparency pursues two aims.

1. **An interface for human intention.** People state what they want as ideas. A connection says how one idea serves another and carries a hypothesis that can turn out wrong. Value flows down the graph, so priorities follow from what people care about rather than from a schedule. AI systems read the graph to know what matters and why. They propose new ideas, which wait for a human to accept them, and they report back with evidence.
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
| `pnpm start --server <name>` | Another server of this machine, with its own accounts, graphs and port, next to the default one (`local`); also with `pnpm dev` |
| `pnpm start:fast` | `start` without rebuilding |
| `pnpm build` / `pnpm build:optional` | Build the core packages / also the MCP server and voice bridge |

Ports and other settings go in `.env` (see `.env.example`). The first `pnpm start` in a terminal asks whether other people use the server and saves the answers in the server's `server.json` (see [Hosting It for a Group](#hosting-it-for-a-group)); `pnpm start --setup` asks again. Voice is opt-in: set `AIMPARENCY_ENABLE_VOICE=true`.

Backend, broker and agent sessions listen on `127.0.0.1` only and answer only pages served from this machine, since they can start agents. The launcher prints the resolved ports and hands them to the frontend's server, which answers `/runtime-config.json` with them (the copy in `packages/frontend/public/` is for scripts). `pnpm validate:local-runtime` checks the port handling without starting the stack.

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

One server holds many graphs for many people: anyone may read every graph,
people with an account create graphs and write the ones they own or were given
write access to, and server admins manage the accounts. On the server (Node.js
22.13+ and git; an https clone needs no GitHub account):

```bash
git clone https://github.com/aimparency/v7.git aimparency
cd aimparency
corepack enable
pnpm install
pnpm start
```

`pnpm start` asks:

1. whether other people use this server: answer yes;
2. the port (default 4000), the address to listen on (`127.0.0.1` behind nginx)
   and the public address people open (`https://<host>`, for MCP clients that
   log in by themselves and for wallet login; also set later under Server settings);
3. whether visitors get an account without asking, and whether anyone may sign up;
4. whether server admins may run wrapped agents (a shell on the server);
5. the first server admin's name and password;
6. optionally a repository on the machine to add as a graph.

From then on `pnpm start` (for example from a systemd unit) serves everything on
that one port: the UI, the API under `/trpc`, and an MCP server under
`/mcp/sse`. A graph has the address `https://<host>/g/<slug>`.

- **The server directory.** What the server owns lives in one directory
  (`~/.local/share/aimparency-local`, or `AIMPARENCY_SERVER_DIR`), never in a
  graph's `.bowman`: `server.json` (the settings), `accounts.json`, `graphs.json`
  (the list of graphs with owner and writers), `graphs/<slug>/`, the git
  repositories of graphs created on the server, `remotes/<slug>/`, the clones
  of graphs added from a Git URL, and `keys/`, the accounts' SSH keys. `server.json` is edited as a
  file and re-read when it changes:

  ```json
  { "login": "accounts", "port": 4000, "host": "127.0.0.1", "agents": false, "graphCreation": "everyone" }
  ```

  `"login": "none"` (or no file) is the local server: no login, the person at
  the machine may do everything. `"graphCreation": "selected"` lets only
  accounts marked "creates graphs" create graphs.
- **Several servers on one machine.** A server has a name; `local` is the one
  every command works on. `--server <name>` selects another one, in
  `~/.local/share/aimparency-<name>`: `pnpm start --server hub` runs it,
  `pnpm accounts --server hub list` and `pnpm graphs --server hub add <path>`
  manage it. Give each a different `"port"` and they run side by side, for
  example your own local server and one you prepare for other people.
  `pnpm dev --server hub` runs that server from source with hot reload.
- **Graphs.** An account creates a graph in the browser in one step and owns
  it; it gets a git repository of its own on the server. The owner gives other
  accounts write access in the graph's settings. `pnpm graphs add <path>` (or, as server admin, "Add a repository on this server" in the browser) lists
  a repository that is already on the machine, `pnpm graphs list|owner|writers|remove`
  manage the list from the terminal.
- **Graphs from a Git URL.** Any account adds a repository that has a
  `.bowman` by its https or ssh URL; the server clones only the `.bowman` and
  follows the remote. It is read-only on the server until its owner selects an
  SSH key in the graph's settings: the server makes the key pair and shows
  only the public key, to add on the remote with write access (on GitHub: a
  deploy key of that repository). From then on the graph is edited on the
  server, committed in the UI and pushed back. For these URLs the server uses
  nothing of its own user's git setup (no credentials, no SSH agent), never
  fetches from its own network, and runs nothing from the repository.
- **Notes from visitors.** An account without rights on a graph leaves notes
  on its ideas: an idea, a question, or "I'd like to work on this". Notes are
  kept on the server (`guest/<slug>/notes.json`), never in the graph's
  repository; the graph's owner and writers see new ones in the header and
  turn what they want into ideas. The owner sets who may leave notes (every
  account, selected accounts, nobody); `"guestDefaults": { "notes": … }` in
  `server.json` is the default for graphs that set nothing. Agents get notes
  only through the MCP tool `list_notes`, marked as visitors' text.
- **Other websites.** Pages of other websites may read a server with accounts
  (the API answers them, so a graph can be shown from anywhere); they never
  write, also not with a valid login. A login is a token the browser keeps
  for this server's own pages; no cookie carries it.
- **Rights.** Reading needs no account. On a graph, its owner and the accounts
  with write access change everything, including its settings and committing;
  only the owner changes who may write and removes the graph. A server admin
  may do all of that on every graph and manages accounts.
- **Getting an account.** Three ways besides the server admin making one,
  set in `server.json`:

  ```json
  { "signUp": { "open": true, "browserKey": true },
    "limits": { "accountsPerAddressPerHour": 100, "graphsPerAccount": 20, "graphMegabytes": 50 } }
  ```

  `open` lets anyone choose a name and a password. `"wallet": true` in
  `signUp`, together with `"publicUrl": "https://<host>"`, adds login with a
  crypto wallet of the browser (Sign-In with Ethereum, checked by the server
  itself, no outside service): a wallet of an existing account logs it in, an
  account adds its wallet, and an unknown wallet gets an account where sign-up
  is open. `browserKey` gives a visitor
  an account without asking, the moment they do something that needs one; it is
  held by a key in their browser, and the UI recommends a name and password
  ("Keep account"), since clearing the browser loses it. Invitations work
  either way: links for one person or for anyone, optionally with an end date,
  made in the Accounts dialog or with `pnpm accounts invite [--once] [--days <n>] [--admin] [--creates-graphs]`.
- **Accounts.** Server admins add people in the UI (Accounts), or on the
  server with `pnpm accounts add <name> [--admin] [--creates-graphs]`,
  `pnpm accounts admin|creates-graphs <name> on|off`,
  `pnpm accounts password|remove <name>` and `pnpm accounts list`. Passwords
  are stored as scrypt hashes, login tokens as hashes.
- **Agents.** Loops stay off on a server with accounts. Wrapped agents (the
  watchdog) are off too unless `"agents": true`: then server admins, and only
  they, get them in the UI. That is a shell on the server as the user
  Aimparency runs as, with read access to whatever that user can read (`/etc`,
  other files) and every secret in Aimparency's `.env`. Make server admin only
  people you would give an SSH login; the setup, `pnpm accounts` and the
  Accounts dialog warn about this. The broker and the agent sessions listen on
  `127.0.0.1`; the one port lets a request through to them only with a server
  admin's login and from the server's own origin. The agents' own Aimparency
  MCP edits graphs as the account `wrapped-agents`, whose token is replaced on
  every start; it writes the graphs it was given write access to.
- **Commits.** Edits change the files in a graph's repository; its owner and
  writers commit them in the UI (the header's commit button). The author is
  git's configured identity, or `"gitAuthor": { "name": …, "email": … }` from
  `server.json` when git has none.
- **Pulling.** Every 5 minutes the server fast-forwards each graph that has an
  upstream to what was pushed there, and open browsers update. It waits while
  a graph's `.bowman` has uncommitted edits and never merges diverged history
  (the log says why it is not pulling). `AIMPARENCY_PULL_SECONDS` sets the
  interval; `0` turns it off. A private repository needs fetch credentials for
  the server's user.
- **MCP.** "MCP" in the account corner connects an MCP client, such as a
  coding agent, as that account: on all its graphs, or only on the graphs
  chosen there. The link contains a login, so it is shown once and handled
  like a password; the dialog lists the connected clients and revokes them. A
  client limited to graphs is nobody elsewhere: it reads other graphs like any
  visitor and cannot manage accounts or create graphs. Tools take the graph's
  slug as `graph`; a link for one graph is that graph's own address
  (`https://<host>/g/<slug>/mcp/sse`), where tools need no `graph`.
  Without a token the MCP can only read. With `"publicUrl"` set in
  `server.json`, a client can also log in by itself (OAuth, as the MCP
  specification describes it) at `https://<host>/mcp/login/sse`: it opens the
  server's page in a browser, the person logs in, chooses the graphs and
  approves, and the client gets a token for exactly that.

To keep it running, a systemd unit such as `/etc/systemd/system/aimparency.service`
(adjust user and path; `pnpm` must be on systemd's PATH, check with `which pnpm`).
Without a terminal `pnpm start` asks nothing and uses the saved answers; it
rebuilds on each start, `pnpm start --no-build` skips that:

```ini
[Unit]
Description=Aimparency
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
client from flooding a public server:

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
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; # limits count per visitor, not per proxy
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
