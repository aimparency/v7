# Product evidence audit for the SPC application

Purpose: keep application language anchored to inspectable implementation. This
is an internal claim ledger, not application prose.

## Safe claims

### Aimparency stores intent as repository-owned graph state

Evidence:

- The live project graph is stored as JSON in `.bowman/aims/` and
  `.bowman/phases/`.
- MCP resources expose individual aims, relationships, phases, and complete
  collections in `packages/mcp/src/resources.ts`.
- Phase commitments are represented on both the phase and aim and checked for
  consistency in `packages/backend/src/routers/project.ts`.

Safe wording: **“Aimparency stores a project's aims, relationships, status, and
time horizons as inspectable files beside the work.”**

Avoid: claiming that Git is required for all uses or that every mutation is
automatically committed.

### Multiple agent runtimes can operate through the same graph

Evidence:

- Session adapters exist for Codex, Claude, Gemini, Grok, and AGY under
  `packages/wrapped-agents/*-session/src/profile.ts`.
- The common supervisor state describes a shared loop from graph orientation to
  execution, verification, reflection, and reprioritization in
  `packages/wrapped-agents/common/src/supervisor-state.ts` and
  `packages/wrapped-agents/autonomy-state-machine.md`.
- MCP exposes model-neutral resources and tools through
  `packages/mcp/src/factory.ts`, `resources.ts`, and `tools.ts`.

Safe wording: **“Codex, Claude, Gemini, Grok, and other executors can be wrapped
around the same model-independent aim graph.”**

Avoid: claiming equivalent production reliability across providers. The code
proves adapters exist, not that every provider has completed the same long-run
benchmark.

### Human authority is represented explicitly

Evidence:

- `human-dependent` is a first-class state with the meaning “blocked on a human
  action” in `packages/mcp/src/constants.ts`.
- MCP guidance tells executors to use `human-dependent` when human action is
  required in `packages/mcp/src/tools.ts`.
- The phase-priority view defaults to this state and includes transitive
  descendants in `packages/frontend/src/components/Phase.vue` and
  `packages/frontend/src/utils/phase-priority.ts`.
- Cycle-safe behavior and transitive inclusion are covered by five focused logic
  tests in `packages/frontend/src/utils/phase-priority.test.ts`; a component test
  in `packages/frontend/src/components/__tests__/Phase.spec.ts` verifies the
  button, default filter, loading calls, labels, ordering, and aim-opening path.

Safe wording: **“The graph makes human gates explicit and can surface them even
when they sit below a larger phase objective.”**

Avoid: calling this complete authorization security. It is an explicit planning
and orchestration boundary; underlying tool permissions remain a separate layer.

### Progress can be connected to implementation evidence

Evidence:

- `packages/backend/src/git-evidence.ts` finds commits whose messages reference
  an aim's identifier prefix.
- `packages/frontend/src/components/AimEditModal.vue` displays those commits as
  implementation evidence.
- MCP reconciliation distinguishes code commits from graph-only bookkeeping in
  `packages/mcp/src/tools.ts`.
- The convention is documented publicly in `README.md`.

Safe wording: **“When a commit cites an aim, Aimparency shows the implementation
beside the intention and uses it as evidence for status reconciliation.”**

Avoid: claiming causal proof. An identifier in a commit is evidence to inspect,
not automatic proof that the aim was achieved.

### The graph supports search, prioritization, phases, and reflection

Evidence:

- MCP tools implement keyword and embedding search, duplicate discovery,
  consistency checking, graph hygiene, phase management, prioritized aim
  selection, and structured reflection in `packages/mcp/src/tools.ts`.
- The frontend combines keyword and semantic results in
  `packages/frontend/src/components/AimSearchPicker.vue`.
- The autonomous loop requires verified outcomes and recorded reflection before
  reprioritizing in `packages/wrapped-agents/autonomy-state-machine.md`.

Safe wording: **“Aimparency combines phase planning, value/cost-informed
prioritization, semantic retrieval, and structured reflection over the same aim
graph.”**

Avoid: implying that calculated priority is an objective measure of value. It is
a decision aid based on authored estimates and graph structure.

## Strongest compact proof bundle

Use these three links in the application:

1. Code and inspectable graph: https://github.com/aimparency/v7
2. Product demo: https://youtu.be/91JPjLPlXUM
3. External recursive experiment:
   https://devpost.com/software/aimparency-the-aim-is-to-win

Together they show implementation, operation, and a consequential use. They do
not show customer demand or repeatable revenue; state those as the next tests.

## Recommended product paragraph

Aimparency is working, open-source infrastructure for preserving human direction
across long-running AI work. A repository-owned graph connects local tasks to
larger aims, represents priorities and human gates, and links claimed progress
to inspectable evidence. Codex, Claude, Gemini, Grok, and other executors can
operate through the same model-independent interface. The product works today
inside its own development process; the unresolved company question is which
narrow organizational workflow feels this governance problem urgently enough
to pay for it.
