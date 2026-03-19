# Backend

`packages/backend` is the local Aimparency server.

It owns the project-facing API and the `.bowman` filesystem data model:

- serves the main tRPC API over HTTP/WebSocket
- reads and writes aims, phases, and project metadata in `.bowman`
- maintains search, vector, cache, and semantic-graph artifacts
- generates local in-process embeddings for semantic search
- recalculates derived aim values after graph changes
- exposes project, graph, system, market, and optional voice routers

## Runtime Role

In normal local use, this package runs as a background service behind the browser UI.

Default ports:

- HTTP: `3000`
- WebSocket: `3001`

The frontend talks to the backend over WebSocket tRPC. The backend is the package that actually touches the target repository and ensures `.bowman/.gitignore` includes generated artifacts such as `vectors.json`, `cache.db`, and `semantic-graph.json`.

## Commands

From the repo root:

```bash
npm run dev:backend
npm run start:backend
npm run test -w backend
```

Inside this workspace:

```bash
npm run dev
npm run start
npm run test
```

## Boundaries

- `backend` is the source of truth for filesystem persistence and project structure.
- `frontend` renders and edits state but should not implement `.bowman` storage rules itself.
- `shared` provides types, constants, and value-calculation logic consumed here.
- The broker is separate and only handles agent session lifecycle.
