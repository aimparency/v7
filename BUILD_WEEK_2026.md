# OpenAI Build Week 2026

Aimparency is entered in the Developer Tools track as a Git-native intent and
dependency layer for Codex. This is a hackathon project and is not affiliated
with or endorsed by OpenAI.

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
npm run build
npm run test:unit
```

The standard local workflow is documented in the main README. Judges can
verify the extension without modifying a repository: open any existing aim
whose UUID occurs in a commit message and inspect **Implementation evidence**
in its edit view. Focused automated coverage lives in:

- `packages/backend/src/git-evidence.test.ts`
- `packages/frontend/src/components/__tests__/AimEditModal.spec.ts`

The repository is available under the ISC license in `LICENSE`.
