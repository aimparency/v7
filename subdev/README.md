# `subdev/` Experiments

`subdev/` contains experiments, side projects, prototypes, and related work that are not part of the main Aimparency onboarding path.

If you are trying to run or understand Aimparency itself, start from the repository root:

- read `../README.md`
- focus on `packages/frontend`, `packages/backend`, `packages/shared`, and `packages/wrapped-agents/broker`
- treat everything under `subdev/` as separate exploratory material unless a specific document tells you otherwise

Important boundaries:

- folders under `subdev/` may have their own dependencies, build outputs, nested git repos, or rough edges
- they are not required for `npm install`, `npm run dev`, or `npm run start` for the main product
- they should not be treated as the public project surface for the first open source release
- the root repository intentionally ignores nested `subdev/*` contents so they do not pollute the main `git status`

For directory-shape notes, see `subdev/structure.md`.
