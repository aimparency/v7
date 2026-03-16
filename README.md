# Aimparency

Aimparency is a local-first planning and coordination tool for work that lives next to real repositories.

It runs as a browser app on your machine and stores project state in a `.bowman` directory inside the repo or workspace you point it at. It can also start local agent sessions on demand through the broker. 

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

Optional, depending on how you use the project:

- Claude CLI for Claude-backed sessions
- Gemini tooling for Gemini-backed sessions
- Codex tooling for Codex-backed sessions

## Install

```bash
npm install
```

Copy the example environment file if you want to customize ports:

```bash
cp .env.example .env
```

The defaults are fine for most local runs.

## Run

Development mode with watch processes:

```bash
npm run dev
```

Build-mode local run with lower overhead:

```bash
npm run start
```

If you already built everything and want to skip rebuilding:

```bash
npm run start:fast
```

By default the user-facing UI runs on `http://localhost:4000`. Backend, broker, and agent-session ports stay in the background.

## How Aimparency Stores Data

Aimparency writes its project data into a `.bowman` directory in the target repo or workspace. That includes aims, phases, caches, and vector/search data.

The backend also maintains `.bowman/.gitignore` entries for generated files such as vector and cache artifacts.

## Current Release Direction

The intended open source usage is:

1. clone the repository
2. run `npm install`
3. use `npm run dev` while developing
4. use `npm run start` for normal local usage

This repo is not currently optimized for global install or hosted deployment. Optional integrations such as MCP and voice are secondary to the local-first workflow.

## Optional Integrations

- MCP: see `packages/mcp/README.md`
- Frontend package notes: see `packages/frontend/README.md`

## Repository Notes

- `subdev/` contains related experiments and side projects; it is not part of the main onboarding path.
- `packages/wrapped-agents/client` is a dev-only broker inspector, not the main product UI.
