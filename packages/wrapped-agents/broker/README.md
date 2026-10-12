# Wrapped Agents Broker

`packages/wrapped-agents/broker` manages local agent session processes.

It is the layer between the main Aimparency app and spawned Claude, Gemini, or Codex watchdog sessions.

## Runtime Role

The broker runs as a background local service and exposes a small tRPC API for:

- starting agent sessions for a project path
- stopping and relaunching sessions
- keepalive tracking
- listing active sessions

It also serves the dev-only broker inspector from `packages/wrapped-agents/client/dist`.

Default ports:

- HTTP: `5000`
- WebSocket: `5001`

Spawned watchdog sessions then listen on their own dynamic ports.

## Commands

From the repo root:

```bash
pnpm dev      # whole stack, servers from source via tsx
pnpm start    # build bundles, then run them
pnpm list-sessions
pnpm stop-sessions
```

Inside this workspace:

```bash
pnpm dev
pnpm start
```

## Boundaries

- The broker manages process lifecycle, not project persistence.
- The backend owns `.bowman` data and project state.
- The frontend should treat the broker as infrastructure for local agent sessions, not as the primary product API.
- The bundled client inspector is for development, not the main user-facing UI.
