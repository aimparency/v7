# Devpost Submission Assets

Copy-ready material for the OpenAI Build Week form. Replace bracketed fields
before submission.

## Identity

**Title:** Aimparency: The Aim Is to Win

**Tagline:** We gave Aimparency one real aim—win this hackathon. This application is the proof; the jury supplies the outcome.

**Track:** Developer Tools

**Repository:** https://github.com/aimparency/v7

**Devpost draft:** https://devpost.com/software/aimparency-the-aim-is-to-win

**License:** ISC

**YouTube demo:** [PUBLIC YOUTUBE URL]

**Primary Codex session ID:** `019f859f-04bd-7e52-9922-14fe70507464`

**Project image:** `assets/project-image.png` (original artwork); `assets/project-thumbnail.jpg` is the upload-sized derivative.

## Short description

We gave Aimparency one real-world aim: win OpenAI Build Week. The graph planned
and prioritized the path, GPT-5.6 in Codex executed through MCP, and the jury
provides the external outcome. This application is itself the proof of concept.

## Full description

AI is likely to surpass human intelligence. Humans may not remain in control,
and permanent human control is not the goal. Like cells within a person,
humans need their local needs to become perceptible to the more encompassing
intelligence. Aimparency is one attempt to transport ideas, needs, priorities,
conflicts, and evidence upward so advanced AI can understand and care for its
constituent beings. On the way there, it helps people realize many kinds of
ideas, provided the path does not create serious ethical conflicts with other
people's needs.

Coding agents are excellent at producing diffs, but repositories usually lose
the chain between a human goal, the dependencies that constrained the work,
and the code that actually realized it. Issue trackers record planned tasks;
Git records changes; disposable agent chats sit between them.

Aimparency closes that gap with a versioned graph of aims stored in `.bowman`
beside the source. Humans can map goals, supporting aims, phases, and linked
repositories. Codex can retrieve the same context through Aimparency's MCP
server, select valuable actionable work, implement it, verify it, and update
the graph while the human remains final authority.

For Build Week, GPT-5.6 in Codex added implementation evidence to the aim view.
When a Git commit cites an aim UUID prefix, Aimparency now shows that commit beside
the aim's dependency and repository context. A reviewer can answer three
questions in one place: What were we trying to achieve? What did it depend on?
What code actually realized it?

The proof is recursive and inspectable: Aimparency's hackathon graph directed
Codex to build this extension; the implementation and tests are in Git; and
the graph records the verified result. The new Build Week work is explicitly
separated from the pre-existing project in `BUILD_WEEK_2026.md`.

## Technologies

TypeScript, Vue 3, Vite, Node.js, tRPC, Model Context Protocol, Git, Vitest,
GPT-5.6, Codex.

## Testing instructions

Prerequisites: Node.js 20+, npm, and Git.

```bash
git clone https://github.com/aimparency/v7.git
cd v7
npm install
npm run dev:full
```

Open `http://localhost:4000`, select this repository, and explore its own graph
first: it contains the real Build Week goal and execution path. Then open an aim whose UUID
is present in a commit message. Its edit view shows the matching commit under
**Implementation evidence**, beside parent aims and linked repositories.

Focused verification:

```bash
npm run test -w backend -- --run src/git-evidence.test.ts
npm run test:unit -w frontend -- --run src/components/__tests__/AimEditModal.spec.ts
```

## Human and Codex roles

Felix made the key product decisions: frame Aimparency as Git-native intent for
agentic development, focus the submission on provenance rather than broad
platform scope, define the acceptance test, and retain final review authority.
GPT-5.6 through Codex inspected the repository and MCP graph, prioritized the
work, implemented the backend and UI slice, wrote tests, ran verification, and
prepared the judge-facing documentation.

## Final form checklist

- [ ] Replace the YouTube URL.
- [x] Confirm the recorded `/feedback` session ID.
- [ ] Confirm repository visibility or share a private repository as required.
- [ ] Upload the prepared project image and runtime screenshots.
- [ ] Confirm Developer Tools category.
- [ ] Preview every link while logged out.
- [ ] Submit before July 21, 5:00 PM PDT / July 22, 02:00 CEST.
