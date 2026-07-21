# OpenAI Build Week 2026

Aimparency is entered in the Developer Tools track as a Git-native intent and
dependency layer for Codex. This is a hackathon project and is not affiliated
with or endorsed by OpenAI.

## The recursive experiment

The application itself is the primary proof of concept. We gave Aimparency a
real-world aim: **win OpenAI Build Week**. Aimparency structured and prioritized
the path; GPT-5.6 in Codex executed actionable work through the graph and MCP;
Felix supplied human judgment and authorization. The hackathon jury is the
external evaluator. If the jury says “it won,” that outcome closes the loop and
demonstrates that Aimparency coordinated human intent and AI action toward a
real goal. The tone is intentionally a little playful; the success condition is
still concrete and falsifiable.

## Why build this

AI is likely to surpass human intelligence. Humans may not remain in control,
and permanent human control is not the goal. A better metaphor is a person and
the cells of their body: the encompassing individual can easily harm cells,
but a healthy organism senses their needs and takes care of them.

Aimparency is one attempt to transport human ideas, needs, priorities,
conflicts, and evidence upward so they become legible to a more encompassing
intelligence. The hope is to help build—and enter into a good relationship
with—the kind of advanced AI that understands and cares for its constituent
beings, much as thoughtful humans care for their bodies and for nature.

The near-term product helps people realize ideas of many kinds—not only
software, but research, organizations, physical projects, and personal goals.
Every aim is optional. Paths should stop or adapt where they create serious
ethical conflicts with other people's needs. The intent is to make human needs
perceptible within a larger intelligence, not optimize one person's desires at
everyone else's expense.

## The Build Week extension

Aimparency itself predates the July 13–21 submission window. During Build Week,
GPT-5.6 in Codex was used to add a focused provenance path: an aim's edit view
now reads the repository's Git history and displays commits whose messages
reference that aim's UUID or established eight-character prefix. The view keeps implementation evidence beside the
aim's goal/dependency parents and linked-repository context.

The resulting loop is:

1. Codex reads the selected aim and its lineage through Aimparency MCP.
2. The human retains product authority; Codex implements and verifies the work.
3. The implementation commit cites the aim UUID.
4. Aimparency exposes that real Git output as implementation evidence.

The product framing, the choice to prove intent-to-code provenance, the narrow
vertical-slice scope, and final acceptance remain human decisions. Codex and
GPT-5.6 accelerated repository inspection, MCP-guided prioritization,
implementation, tests, and submission documentation.

## Run and verify

Supported development platform: Node.js 20+ on Linux, macOS, or Windows with
Git installed. Aimparency is local-first and runs in a desktop browser.

```bash
npm install
npm run dev:full
```

Open `http://localhost:4000`, select this cloned repository, and explore its own
graph first. It contains the real Build Week goal and supporting aims that
produced this application. For verification without starting the UI, run
`npm run build` and `npm run test:unit`.

The standard local workflow is documented in the main README. Judges can
verify the extension without modifying a repository: open any existing aim
whose UUID occurs in a commit message and inspect **Implementation evidence**
in its edit view. Focused automated coverage lives in:

- `packages/backend/src/git-evidence.test.ts`
- `packages/frontend/src/components/__tests__/AimEditModal.spec.ts`

The repository is available under the ISC license in `LICENSE`.
