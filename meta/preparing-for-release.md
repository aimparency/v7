# Aimparency Open Source Release Preparation

## Release Goal

Make Aimparency publishable as a local-first open source project:

- users clone the repository
- users install dependencies once
- users run `npm run dev` while developing
- users run `npm run start` for a lighter build-mode local run
- users typically point Aimparency at nearby git repositories
- hosting is not the primary story

This is not a hosted SaaS rollout plan. It is a repository, docs, and local runtime cleanup plan.

## Product Shape

Aimparency should be framed as:

- a browser UI running on the user's machine
- a local backend that reads and writes project state inside `.bowman`
- a local broker that starts agent sessions on demand
- optional MCP integration for Claude/Cursor-style tooling
- optional voice features

That makes the product closer to Jupyter or Home Assistant than to a multi-tenant web app.

## Current Runtime Model

### Development

`npm run dev` currently starts a broad development stack:

- backend in watch mode
- frontend Vite dev server
- broker in watch mode
- session package watchers
- Python embedder
- MCP dev process
- voice bridge
- dev-only broker client inspector

This is useful for active development, but it is too heavy to present as the primary open source usage story.

### Local Build Mode

For normal local use, the project should converge on:

- frontend on its own user-facing port
- backend on a background port
- broker on background ports
- sessions spawned dynamically on background ports
- optional services started only when needed

The user should mainly care about the frontend URL. The rest are implementation details.

## Architecture Decisions

### 1. Keep browser-based UI

Do not move toward Electron right now.

Reasons:

- the browser UI already exists
- local browser access is good enough for the intended workflow
- Electron would increase packaging and maintenance work before the core open source release is ready

### 2. Keep broker-managed session spawning

This already matches the intended usage:

- sessions are started on demand
- different agent types can stay independent
- idle users do not pay the memory cost of all sessions up front

The dev session watchers are a development convenience, not the release model.

### 3. Inline the embedder into the Node backend

Removing the Python embedder remains a strong simplification target.

Benefits:

- one less runtime dependency
- simpler onboarding
- less process overhead
- easier documentation
- fewer failure modes on first run

The target is one Node-based setup story, with Python no longer required.

### 4. Keep MCP as optional integration

MCP should not be part of the minimum "I cloned it and it works locally" story.

Instead:

- core app works without MCP
- MCP gets a dedicated setup section in docs
- MCP setup assumes backend is already running locally

## Ports and Startup Model

### User-facing expectation

The main visible endpoint is the frontend, for example:

- frontend: `http://localhost:4000`

Background services may use ports such as:

- backend HTTP
- backend WS
- broker HTTP
- broker WS
- dynamically assigned session ports

### Important requirement

The release plan should not assume fixed ports always remain free.

We should support:

- default ports for convenience
- dynamic fallback when a preferred port is already occupied
- clear startup logs that show the actual chosen ports
- frontend configuration that can connect to the chosen backend and broker ports

This is especially important for local use, where developers often already have tools running on common ports.

## Open Source Release Priorities

### Priority 1: Repo hygiene

Before publishing widely:

- remove placeholder documentation
- make ignore rules sane for generated artifacts and local-only files
- avoid committing local runtime junk
- make sure the repository surface looks intentional

### Priority 2: Root onboarding docs

Add a strong root `README.md` that answers:

- what Aimparency is
- who it is for
- what gets written to `.bowman`
- minimum prerequisites
- how to install
- how to run in dev mode
- how to run in build mode
- which parts are optional

### Priority 3: Build-mode local startup

Support:

- `npm run dev` for development
- `npm run start` for lighter local runtime

`npm run start` can build automatically before launching, at least initially.

That is acceptable for the first open source release. Smarter incremental behavior can come later.

### Priority 4: Runtime simplification

Reduce required moving parts:

- inline embedder into backend
- keep voice optional
- keep MCP optional
- keep dev-only tools out of the default user path

### Priority 5: Package-level docs

At minimum:

- root README
- frontend README that explains its role in the app
- MCP README kept accurate
- dev-only packages marked as dev-only

## Revised Implementation Plan

### Phase 1: Documentation and repo hygiene

Goal: make the repository look publishable and understandable.

Tasks:

1. Add a real root `README.md`
2. Replace placeholder package READMEs
3. Tighten `.gitignore`
4. Document optional dependencies and local data layout
5. Clarify which packages are user-facing versus internal/dev-only

### Phase 2: Build-mode startup

Goal: support normal local usage without watch mode.

Tasks:

1. Add root `npm run start`
2. Run frontend in preview/build mode
3. Run backend and broker from built output
4. Keep optional services out of the default startup path
5. Print the frontend URL clearly

### Phase 3: Port management cleanup

Goal: make local startup robust.

Tasks:

1. Detect preferred-port conflicts
2. Fall back to free ports when needed
3. Expose resolved ports to the frontend
4. Avoid hardcoded localhost assumptions where same-origin or runtime config is better

### Phase 4: Inline embedder

Goal: eliminate the Python dependency from the default path.

Tasks:

1. add a Node embedding implementation in backend
2. preserve embedding compatibility well enough for existing vector workflows
3. remove Python embedder from default dev/start flows
4. update docs accordingly

### Phase 5: Optional integrations cleanup

Goal: keep the core app simple and optional features explicit.

Tasks:

1. document MCP setup separately
2. document voice bridge separately
3. mark broker client as dev-only
4. verify the default experience works without optional tools installed

## Non-Goals for This Release Pass

Do not optimize for these yet:

- global install
- `npx aimparency`
- hosted multi-user deployment
- Electron packaging
- one-binary distribution

Those may become useful later, but they should not drive the first open source release.

## Definition of Done

The release prep is in good shape when:

1. a new user can clone the repo and understand it from the root README
2. `npm install` works without extra scavenger hunting
3. `npm run dev` works as the development story
4. `npm run start` works as the lighter local runtime story
5. optional integrations are clearly separated from the core experience
6. the repo no longer exposes placeholder or template docs as if they were real project docs
