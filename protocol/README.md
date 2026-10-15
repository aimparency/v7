# The .bowman format (protocol v0, data model version 4)

A `.bowman` directory stores an idea graph as plain JSON files inside a Git
repository. Git is the history: files hold the current state only, and every
change is a normal commit. Any tool can read and write a project with nothing
but a JSON parser; Aimparency's backend, MCP server and agents are clients of
this format, not its owners.

This document is normative for data model version 4. The JSON Schemas in
[`schemas/`](schemas/) are generated from the code that reads the format and
define the shape of each file; the rules below add what a schema cannot
express. Check a project with:

```sh
pnpm validate:bowman <project root or .bowman directory>
```

## Layout

| Path | Content | Schema |
| --- | --- | --- |
| `meta.json` | Project settings, statuses, data model version | [`meta.schema.json`](schemas/meta.schema.json) |
| `ideas/<id>.json` | One active idea | [`idea.schema.json`](schemas/idea.schema.json) |
| `archived-ideas/<id>.json` | One archived idea | [`idea.schema.json`](schemas/idea.schema.json) |
| `phases/<id>.json` | One phase | [`phase.schema.json`](schemas/phase.schema.json) |

Everything else in `.bowman/` is not part of the protocol. Some of it is
machine-local and gitignored (`runtime/`, `cache.db`, `vectors.json`,
`semantic-graph.json`, `secrets.json`, `.migration-lock`); some is
tool-specific and committed (`system.json`, `memory/`, `thoughts/`). Readers
ignore what they do not know; validators do not check it.

## Files and identity

- Every file is a single UTF-8 JSON object, written with two-space indentation
  so diffs stay line-oriented.
- Ideas and phases are identified by a UUID. The file name is the id:
  `ideas/<id>.json` contains `"id": "<id>"`.
- An idea lives in exactly one of `ideas/` and `archived-ideas/`.
- Objects carry only the properties in their schema. Unknown properties are
  invalid (writers drop them), which keeps typos from silently becoming data.
- Properties with a schema `default` may be omitted; readers apply the default.

## Ideas

An idea is a unit of intent at any scale, from a mission to a one-line fix.

- `text` is the title; `description` the details.
- `status.state` names one of the project's statuses (see below) or
  `archived`. `status.comment` explains the current state, `status.date` is the
  time of the last real transition (milliseconds since the epoch), and
  `status.reviewedAt` confirms that the state still holds without changing
  `date`.
- `intrinsicValue` (≥ 0) is the idea's standalone estimated value, `cost` (> 0)
  its estimated direct cost in the project's `costUnit`, and `duration` the
  estimated days until its value is realized. `valueRationale` explains the
  value estimate. `calculated*` properties are derived caches; readers must not
  trust them and writers may omit them.
- `reflection` is a free-text note on how the work went; `reflections` holds
  structured evaluations.
- `tags`, `color` (`#rrggbb`) and `archived` are presentation and filtering
  hints.
- Ideas carry no dates for scheduling: urgency is expressed through order,
  value, cost and duration, never through deadlines.

### Links between ideas

A link means "the child supports the parent": achieving the child contributes
to the parent. The graph is directed and may contain cycles.

- The parent lists the child in `supportingConnections` as
  `{ ideaId, weight, relativePosition, hypothesis?, evaluation? }`. The array
  order is the child order.
- The child lists the parent's id in `supportedIdeas`.
- Every link is recorded on both ends. A link recorded on one end only is
  invalid.
- `weight` (default 1) sets the child's share of the parent's value:
  `share = weight / (sum of sibling weights + the parent's loopWeight)`.
- `hypothesis` says why the child should help; `evaluation` records how that
  turned out once the child is settled.
- `relativePosition` is layout only: the child's position relative to the
  parent in a 2D graph view, in units of the two ideas' radii summed. Writers
  round it to two decimals.
- `supportingRepos` links an idea to a whole other repository
  (`{ repoId, weight, relativePosition, ... }`, see `meta.linkedRepos`). Such
  links are one-sided: the other repository keeps no back-reference.
- `incoming` is deprecated and only read from older files.

## Phases

Phases group commitments ("what we do now / next"), not dates.

- `name`, `parent` (a phase id or `null` for a root phase), `childPhaseIds`
  (ordered children) and `commitments` (ordered idea ids; earlier means
  earlier).
- An idea committed to a phase lists the phase id in its `committedIn`, and the
  phase lists the idea in `commitments`. Both ends are required, as for links.
- `from`, `to` and `order` are legacy and only read from older files.
- `meta.rootPhaseIds` orders the root phases.

## Project meta

- `name`, `color`, and `dataModelVersion`, which must be `4` for this version
  of the protocol.
- `statuses` defines the project's states: `key` (`[a-z0-9-]+`), `color`, and
  `promptsEvaluation` (entering the state asks to evaluate the idea's links).
  `ongoing` is informational. Without `statuses`, Aimparency's defaults apply:
  open, in-progress, partially, review, implemented, halted, cancelled, failed,
  unclear, human-dependent.
- `costUnit` and `defaultCost` define what cost numbers mean.
- `repoId` identifies this repository for links from other repositories;
  `linkedRepos` lists repositories this one links to (identity and a URL hint,
  never a local path).
- `phaseCursors`, `phaseActiveLevel`, `initialInstructions` and
  `supervisorGuidancePrefix` are client settings stored with the project.

## Versions

`meta.json` `dataModelVersion` names the format version. Aimparency upgrades
older projects in place through idempotent migrations when it opens them, and
refuses to write projects with a newer version than it knows. A reader that
only understands version 4 should reject other versions rather than guess.
Frozen examples of earlier versions live in
`packages/shared/fixtures/data-model-<N>/`.
