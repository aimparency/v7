# Frontend

This package is the main Aimparency browser UI.

It talks to:

- the backend over WebSocket tRPC
- the broker over WebSocket tRPC
- spawned agent-session processes over Socket.IO

For normal project usage, run the app from the repo root instead of starting this package in isolation.

## Root-level Commands

Development mode:

```bash
pnpm dev
```

Build-mode local run:

```bash
pnpm start
```

## Package-level Commands

Run only the frontend dev server:

```bash
pnpm --filter frontend dev
```

Build the frontend:

```bash
pnpm --filter frontend build
```

Preview the built frontend:

```bash
pnpm --filter frontend preview
```

## Tests

Unit tests:

```bash
pnpm --filter frontend test:unit
```

End-to-end tests:

```bash
pnpm --filter frontend test:e2e
```

On a fresh machine, Playwright browsers may need to be installed first:

```bash
pnpm exec playwright install
```
