# Conversational aim elicitation

## Outcome

A human can describe a goal in ordinary language, receive an editable proposed
aim tree, and explicitly approve all or part of it before any durable graph
mutation occurs.

Conversation is input, not authorization. A model response must never call
`create_aim` while it is still eliciting or decomposing the goal.

## Minimal flow

1. **Elicit** — capture the human's words and ask only for missing information
   that materially changes the proposed structure.
2. **Propose** — return a transient tree with local proposal IDs. Nothing is
   written to `.bowman`.
3. **Edit** — the human may rename, describe, reorder, delete, add, change
   status/value/cost guesses, and adjust contribution weights.
4. **Review** — show the complete mutation summary: aims to create, existing
   parents to connect, phase commitment, and any warnings.
5. **Approve** — one explicit action submits the approved snapshot. Approval
   applies to that exact revision, not subsequent model changes.
6. **Persist** — create aims and edges, return the durable IDs, and navigate to
   the created root. A partial failure must be visible and recoverable.

## Proposal contract

```ts
type AimProposal = {
  revision: string
  sourceText: string
  root: ProposedAim
  existingParentIds: string[]
  phaseId?: string
  assumptions: string[]
  questions: string[]
}

type ProposedAim = {
  proposalId: string
  text: string
  description?: string
  children: ProposedConnection[]
  intrinsicValue?: number
  cost?: number
  status?: 'open' | 'unclear' | 'human-dependent'
  statusComment?: string
  tags?: string[]
}

type ProposedConnection = {
  child: ProposedAim
  weight: number
  explanation?: string
}
```

`proposalId` is local to the draft. It must never be accepted as an aim UUID.
The server assigns all durable IDs during persistence. Guessed values and costs
must be visually marked as estimates.

## State machine

```text
idle → eliciting → proposed ↔ editing → reviewing → persisting → persisted
                    ↑          ↓             ↓
                    └── revise ┘         failed/retry
```

- A new transcript while `reviewing` creates a new revision and invalidates the
  previous approval target.
- Closing the view before approval discards the transient proposal unless the
  human explicitly saves a local draft.
- `persisting` disables duplicate submission.
- Retrying uses an idempotency key derived from project, proposal revision, and
  approval action.

## Server boundary

Use two separate operations:

- `proposeAimSubtree(transcript, context)` may call a model but has no graph
  write capability. Its result is schema-validated and size-limited.
- `approveAimSubtree(proposal, revision, idempotencyKey)` performs graph writes
  only. It does not call a model or reinterpret text.

Approval validation:

- maximum 30 new aims and depth 5 in the first version;
- non-empty, bounded text fields;
- all existing parents and phase IDs still exist;
- finite non-negative costs and intrinsic values;
- finite connection weights greater than zero;
- no connections to archived aims;
- no source-supplied durable IDs;
- reject stale revisions and repeated idempotency keys safely.

Persistence should pre-generate UUIDs, validate the complete resulting graph,
then write root-to-leaf. Record the created ID map. If a write fails, report the
map and exact incomplete operation; do not claim atomicity until storage offers
a transaction or journaled rollback.

## Model context

Give the proposer only:

- the human transcript and recent clarification turns;
- explicitly selected existing parent/phase;
- titles and descriptions from `get_aim_context` or search results;
- the permitted status vocabulary and limits above.

Do not expose secrets, runtime files, unrelated graph branches, or write tools.
The model should return assumptions and unresolved questions rather than hiding
uncertainty inside confident aim text.

## First UI slice

Start with text input even though VoiceView exists. Show a recursive editor with
one card per proposed aim and visible Delete/Add child controls. The review
screen must state **“Nothing has been added to the graph yet.”** The approval
button states the number of aims and connections it will create.

Voice can later supply the same transcript input. It is not a separate proposal
or persistence architecture.

## Acceptance tests

1. Proposing produces no files, aims, edges, phases, or status changes.
2. Editing a proposal changes the approval snapshot without calling a model.
3. A new proposal revision invalidates an older approval.
4. Approving a three-level proposal creates exactly the displayed structure.
5. Double-click/retry creates no duplicates.
6. Missing parent or phase fails before the first write.
7. Invalid weights, excessive size/depth, or archived parents are rejected.
8. A write failure reports what persisted and never says the tree was complete.
9. Cancelling leaves the graph byte-for-byte unchanged.
10. Text and voice entry produce the same proposal contract.

## Implementation sequence

1. Add shared proposal schemas and pure validation/flattening tests.
2. Add approval persistence with idempotency and failure reporting.
3. Add model-backed read-only proposal generation.
4. Build the recursive text editor and review screen.
5. Route VoiceView transcripts through the same proposal endpoint.
6. Test with non-technical users before enabling agent execution from newly
   approved aims.

The first product milestone ends at durable human-approved graph creation. It
does not automatically start a worker or promise that the decomposition is
correct.
