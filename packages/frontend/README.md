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
npm run dev
```

Build-mode local run:

```bash
npm run start
```

## Package-level Commands

Run only the frontend dev server:

```bash
npm run dev -w frontend
```

Build the frontend:

```bash
npm run build -w frontend
```

Preview the built frontend:

```bash
npm run preview -w frontend
```

## Tests

Unit tests:

```bash
npm run test:unit -w frontend
```

End-to-end tests:

```bash
npm run test:e2e -w frontend
```

On a fresh machine, Playwright browsers may need to be installed first:

```bash
npx playwright install
```
