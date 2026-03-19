# Shared

`packages/shared` contains the common contract used across Aimparency packages.

It exports:

- shared TypeScript types and Zod schemas
- constants such as `AIMPARENCY_DIR_NAME`
- value-calculation logic for aims
- date/time and vector helpers
- shared router types used by the frontend and backend

## Why It Exists

This package keeps the frontend, backend, and related tools aligned on the same data model. If an aim, phase, or project-meta shape changes, the change should normally start here.

## Build Output

This package compiles to `dist/` and is consumed by other local workspaces.

Commands:

```bash
npm run build -w shared
npm run dev -w shared
npm run test -w shared
```

## Boundaries

- Put reusable types, schemas, constants, and pure logic here.
- Do not add backend filesystem code or frontend UI code here.
- Keep runtime assumptions minimal so both browser and Node packages can consume the exports safely.
