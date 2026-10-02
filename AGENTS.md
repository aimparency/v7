# Repository Agent Instructions

## Runtime

- Never start, restart, stop, or replace a development server for this
  repository unless the user explicitly asks for that exact action.
- Assume the local development stack is already running.
- Verify changes with focused tests, builds, static checks, or the existing
  runtime instead of launching another server.

## Idea Completion

- Use `review` when implementation and internal verification are complete but
  the feature still needs to be shown to and accepted by the user.
- Move an idea from `review` to `implemented` only after explicit user confirmation.


## Data Model Changes

- `.bowman` files are versioned by `dataModelVersion` in `meta.json`
  (`CURRENT_DATA_MODEL_VERSION` in `packages/shared/src/constants.ts`).
- Change the stored format only through a migration: add it to
  `BOWMAN_MIGRATIONS` in `packages/shared/src/bowman-migration.ts` (code in
  `bowman-migrations/`), bump the constant, and add a frozen
  `packages/shared/fixtures/data-model-<N>/` example of the previous format.
- Migrations must be idempotent; give them a `pending` check when legacy data
  can return through git after the upgrade.
- Before merging, run `npm run verify:migration -- <repo>` on real projects.
