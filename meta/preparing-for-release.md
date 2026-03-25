# Aimparency Open Source Release Preparation

## Release Goal

Publish Aimparency as a local-first open source project:

- users clone the repository
- users run `npm install`
- users use `npm run dev` while developing on Aimparency itself
- users use `npm run start` for a lighter local run
- users point Aimparency at nearby repos or workspaces
- Aimparency stores state in a `.bowman` directory next to the code it describes

This is not a hosted SaaS launch plan. It is a repository readiness and local runtime checklist.

## Product Shape

Aimparency should be presented as:

- a browser UI running on the user's machine
- a local backend that owns `.bowman` persistence
- a local broker that starts agent sessions on demand
- optional MCP integration for external agent tooling
- optional voice features

That makes the product closer to Jupyter or Home Assistant than to a multi-tenant web service.

## Architecture Decisions

These decisions are intentionally in scope for the first public release:

- keep the browser-based UI
- keep broker-managed session spawning
- keep MCP optional rather than required
- keep voice optional rather than required
- inline embeddings into the Node backend for the default local path

These are intentionally out of scope for this release pass:

- hosted multi-user deployment
- global install or `npx aimparency`
- Electron packaging
- one-binary distribution

## Publishability Checklist

Use this as the release-prep definition of done.

### 1. Root onboarding

- [x] Root `README.md` explains what Aimparency is and who it is for
- [x] Root `README.md` documents `npm install`, `npm run dev`, and `npm run start`
- [x] Root `README.md` explains the local-first `.bowman` workflow
- [x] Root `README.md` makes optional integrations secondary to the core local runtime
- [x] Root docs include a concise troubleshooting section for common local startup failures

### 2. Local data model clarity

- [x] Docs explain that users should point Aimparency at a repo or workspace root, not usually at `.bowman` directly
- [x] Docs describe the `.bowman` layout and generated artifacts
- [x] Docs clearly explain what should and should not be committed from `.bowman`
- [x] Docs explain how multiple local projects/repos are expected to be used from one running Aimparency instance

### 3. Repository surface and package docs

- [x] Placeholder or template docs have been replaced in the main user-facing packages
- [x] `packages/frontend/README.md` explains the frontend's role
- [x] `packages/backend/README.md` explains backend ownership of `.bowman`
- [x] `packages/wrapped-agents/broker/README.md` explains the broker's role
- [x] `packages/mcp/README.md` reflects current local-first setup
- [x] Public-facing package manifests and metadata have been audited for publishing readiness
- [x] The repo has a clear `LICENSE` file and consistent repository metadata where appropriate

### 4. Release-story boundaries

- [x] The docs say clearly that hosting is not the primary story
- [x] The docs say clearly that global install and `npx` are not release goals
- [x] Dev-only broker tooling is identified as dev-only
- [x] `subdev/` and other experiments are clearly fenced off from the main onboarding path
- [x] Experimental or archival directories outside `packages/` are either documented or deliberately de-emphasized

### 5. Local startup behavior

- [x] `npm run dev` is the documented development flow
- [x] `npm run start` exists as the documented lighter local runtime flow
- [x] Frontend runtime config no longer hardcodes browser-side `localhost` assumptions for backend and broker
- [ ] Clean-clone startup has been verified on a normal machine for both `npm run dev` and `npm run start`
- [x] Startup logs clearly show the frontend URL and resolved background ports

### 6. Port and runtime robustness

- [ ] Preferred ports fall back cleanly when already occupied
- [x] Frontend consumes the resolved runtime config after fallback
- [x] A validation script or repeatable verification flow exists for launcher/runtime-config behavior
- [ ] Build-mode local runtime works without hidden watch-mode assumptions

### 7. Optional integrations and dependencies

- [x] MCP is documented as optional
- [x] Voice is documented as optional
- [x] Default install/run flow works without optional agent tooling or voice tooling installed
- [x] Python embedder is removed from the default local architecture

## Current High-Leverage Work

The remaining release blockers are mostly in four buckets:

1. verify clean-clone startup on a normal machine
2. finish port fallback and resolved-port reporting
3. make the default install path tolerant of optional integrations being absent
4. de-emphasize any remaining experimental surface outside the main product path

## Definition of Done

Release prep is in good shape when:

1. a new user can clone the repo and understand the project from the root docs
2. `npm install`, `npm run dev`, and `npm run start` work without scavenger hunting
3. `.bowman` behavior is understandable and git-friendly
4. optional integrations are clearly separated from the core experience
5. the repository surface looks intentional instead of exploratory
