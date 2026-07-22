# Prototype Fund application draft — Jahrgang 03

Drafted against the official Application Guide and FAQ checked 22 July 2026.
The application window is expected to run 1 October–30 November 2026, with a
funding start in June 2027. Text between `BEGIN` and `END` markers is the exact
answer to paste; the markers are also used by `check-word-limits.sh`.

## Project title

**Open Intent Protocol: Git-native provenance for human–AI software work**

## 1. Project description — maximum 100 words

<!-- BEGIN answer-01 limit=100 -->
AI coding tools accelerate implementation, but the intent behind their changes
is scattered across chats, issue trackers, and proprietary services. We will
develop an open, Git-native protocol and standalone tools for recording goals,
dependencies, rationale, lifecycle state, and links to implementation evidence.
The result will be a versioned specification, machine-readable schema, command-
line validator, typed library, provenance conventions, and an interoperability
adapter. Projects will be able to keep their intent locally, review it through
ordinary Git workflows, switch assistants without losing context, and inspect
what an agent claims to have realized without depending on Aimparency or a
hosted platform.
<!-- END answer-01 -->

## 2. Social issue — maximum 175 words

<!-- BEGIN answer-02 limit=175 -->
Software increasingly mediates public life while AI systems increasingly help
produce it. Yet the decisions, goals, and constraints behind AI-assisted
changes are often retained only in private conversations or vendor platforms.
Code repositories show what changed, but rarely preserve why it mattered, who
or what proposed it, which human decisions remain unresolved, or what evidence
supports a completion claim. This weakens accountability, makes handovers
difficult, and locks teams into particular assistants and services.

An open intent protocol gives maintainers and small teams control over this
context. Intent remains local, readable, diffable, forkable, and reviewable
with the source code. Contributors can change tools without discarding project
memory. Reviewers can distinguish a claim from locally checkable evidence and
understand the limits of that evidence. Independent developers can build
compatible interfaces instead of rebuilding closed planning silos. The project
therefore strengthens digital sovereignty and transparent human oversight of
AI-assisted development without requiring a central authority or pretending
that provenance proves truth.
<!-- END answer-02 -->

## 3. Technical realization — maximum 175 words

<!-- BEGIN answer-03 limit=175 -->
We will extract a minimal protocol from Aimparency's working file-based model
and specify stable identifiers, aims, directed dependencies, rationale,
lifecycle state, provenance records, extensions, and version migration. A
machine-readable schema and semantic validator will detect invalid references,
cycles where prohibited, incompatible versions, and unsupported evidence
claims. Public fixtures will define conformance and Git merge behavior.

A standalone TypeScript command-line tool will initialize data, validate it,
query graphs, migrate versions, and emit deterministic CI output. A typed
library will support other tools. Git conventions will associate commits and
artifacts with aims while distinguishing claimed, verified, partial, and
contradicted evidence. A privacy and threat analysis will state what local
checks cannot establish.

One independently useful adapter, selected after user research, will exchange
a documented subset with an issue tracker or generic format. Aimparency will
become a reference consumer rather than the protocol owner. Automated tests,
five external repository trials, documentation, and an open governance proposal
will support adoption. All funded outputs will be released as free and open-
source software.
<!-- END answer-03 -->

## 4. Current status — maximum 100 words

<!-- BEGIN answer-04 limit=100 -->
Aimparency already stores aims, dependencies, statuses, and rationale as files
alongside a Git repository. It provides graph and list interfaces, local MCP
tools for assistants, and commit scanning for aim identifiers. This validates
the core representation through daily use on its own development. However, the
schema still mixes portable concepts with application and interface concerns.
There is no independent specification, compatibility guarantee, conformance
suite, standalone CLI, or externally validated adapter. Provenance semantics
are implicit. The funded project is a reusable infrastructure module that
extracts and tests this protocol; it is not maintenance or general feature work
on the existing application.
<!-- END answer-04 -->

## 5. Project link — optional

- Public repository: `https://github.com/aimparency/v7` — verify that it is
  publicly accessible and suitable before submission.
- Optional public demo/documentation URL: `[FOUNDER TO SUPPLY OR OMIT]`

## 6. Innovation and comparable projects — maximum 100 words

<!-- BEGIN answer-06 limit=100 -->
GitHub Issues and OpenProject represent tasks, hierarchies, and dependencies;
W3C PROV-O represents general provenance. This project connects a smaller,
value-bearing intent graph directly to versioned source repositories and the
work of coding agents. Its distinct contribution is a tool-independent protocol
for goals, rationale, human-dependent decisions, and bounded realization claims,
with deterministic local validation and ordinary Git transport. Unlike an
issue tracker, it needs no hosted service. Unlike a general provenance ontology,
it provides developer-ready conventions, migrations, fixtures, and CLI tools.
Unlike Aimparency today, the result can be adopted and implemented without the
original application.
<!-- END answer-06 -->

## 7. Users and target group — maximum 100 words

<!-- BEGIN answer-07 limit=100 -->
Primary users are maintainers of free and open-source projects who use coding
assistants, small technical teams working across several agent tools, and
developers building planning or agent integrations. They need project intent
to survive changes of model, assistant, contributor, and hosting provider.
Initial research will recruit maintainers from at least five external
repositories and integration developers who can challenge the protocol
boundary. Adoption will not require Aimparency, an account, or a hosted
service. Secondary beneficiaries are reviewers and future contributors who
need to understand why AI-assisted changes were proposed and what evidence
supports their stated status.
<!-- END answer-07 -->

## 8. Milestones — maximum 100 words

<!-- BEGIN answer-08 limit=100 -->
Month 1: interview maintainers; publish protocol boundary and privacy/threat
draft. Month 2: release schema, semantic validator, conformance fixtures, and
version rules. Month 3: deliver standalone initialize, validate, query, and CI
commands; trial two external repositories. Month 4: implement Git provenance,
evidence states, and local verification; test real agent-generated changes.
Month 5: release typed library, one externally useful adapter, and an
Aimparency reference adapter; reach five repository trials. Month 6: complete
migrations, documentation, accessibility review, governance and sustainability
proposal, public report, demonstration, and a stable open-source prototype
release.
<!-- END answer-08 -->

## 9. Team — optional, maximum 30 words

<!-- BEGIN answer-09 limit=30 -->
Felix Niemeyer develops the project solo, combining software architecture,
TypeScript, graph systems, agent integration, Git workflows, product design,
and long-term daily use of the existing prototype.
<!-- END answer-09 -->

## 10. Experience — maximum three examples and 100 words

<!-- BEGIN answer-10 limit=100 -->
1. Aimparency (2025–present): architect and lead developer of a local-first
intent graph with TypeScript, Vue, tRPC, MCP integrations, semantic search,
Git-backed storage, and multi-agent workflows.

2. AI-native software development: builds and evaluates working software with
modern coding agents while using the resulting workflow failures to refine
Aimparency's model.

3. Cross-disciplinary systems work: experience in IT consulting and live
visuals for major European electronic-music festivals, combining technical
delivery with real-time operational constraints.
<!-- END answer-10 -->

The third example and the phrasing “major” require founder confirmation. Add
links only where they can be substantiated publicly.

## 11. Funded hours — number only, maximum 950

**950**

The application asks only for the total. The milestone-first internal
allocation is:

| Deliverable | Hours |
|---|---:|
| User research, protocol boundary, privacy and threat model | 130 |
| Specification, schema, versioning, migrations, fixtures | 180 |
| Standalone CLI, queries, validation, and CI output | 210 |
| Git provenance conventions and evidence verification | 150 |
| Typed library and two reference adapters | 140 |
| External trials, hardening, documentation, governance, release | 140 |
| **Total** | **950** |

At the FAQ's published rate of €50 per hour, 950 hours corresponds to the
maximum **€47,500** solo grant. Recheck the rate and cap immediately before
submission. This is a grant calculation, not a claim that progress should be
managed by hours.

## 12. Motivation — maximum 100 words

<!-- BEGIN answer-12 limit=100 -->
I built Aimparency because coding agents could implement isolated requests but
could not reliably retain the larger intention behind a project. Daily use
showed me that this is not only an interface problem: projects need a portable,
inspectable memory that humans and different agents can share. I want to turn
that working experiment into public infrastructure that does not require my
application or any particular AI provider. Prototype Fund would give me the
focused development time, external feedback, and open-source community needed
to define the boundary carefully and validate it beyond my own repository.
<!-- END answer-12 -->

## 13–15. Optional second funding stage

**Recommended selection: Yes — founder decision required.** The second stage
would test broader interoperability and community governance after the core
protocol has demonstrated value. Do not present it as guaranteed continuation.

### 14. Second-stage focus — maximum 175 words

<!-- BEGIN answer-14 limit=175 -->
A second stage would move from a validated protocol prototype to a durable
interoperability ecosystem. Work would be conditional on the first stage
showing that external maintainers can adopt the protocol and that at least one
adapter preserves useful semantics. The focus would be additional adapters for
widely used forge and planning tools, cross-implementation compatibility tests,
and governance that prevents Aimparency from controlling the standard.

We would recruit independent implementers, formalize a lightweight proposal
process for protocol evolution, test distributed graph changes in larger
repositories, and improve privacy-preserving ways to publish only selected
intent. Security review and long-term maintenance responsibilities would be
made explicit. The stage would also examine sustainable support models for
open infrastructure without putting the protocol or user data behind a hosted
service. Success would mean multiple independent implementations exchanging
conformant data and a contributor group able to evolve the protocol beyond one
founder or application.
<!-- END answer-14 -->

### 15. Second-stage milestones — maximum 100 words

<!-- BEGIN answer-15 limit=100 -->
Month 1: evaluate first-stage adoption and agree priorities with external
implementers. Month 2: publish compatibility profiles and an expanded test
suite. Month 3: release two additional forge or planning-tool adapters. Month
4: test selective publication, distributed edits, privacy, and security in
larger repositories. Month 5: establish an open proposal and release process
with independent contributors. Month 6: complete cross-implementation testing,
maintenance commitments, sustainability documentation, and a stable ecosystem
release demonstrated by multiple independent tools exchanging conformant
intent data.
<!-- END answer-15 -->

## Submission blockers and checks

- Confirm Felix applies as an eligible individual residing in Germany and can
  perform the funded work under the program's self-employment/release rules.
- Confirm whether an existing or planned company affects eligibility; the FAQ
  says companies cannot apply.
- Confirm the solo-applicant framing and all biography/experience claims.
- Decide yes/no on the optional second stage.
- Make the funded outputs publicly available under accepted FOSS licenses and
  select the exact licenses before submission.
- Recruit or at least identify five external repository trials; user evidence
  remains the main weakness.
- Recheck the live form, guide, FAQ, dates, rate, and word limits in October.
- Remove all brackets, notes, and `BEGIN`/`END` markers before pasting.

## Primary references

- Prototype Fund Application Guide:
  https://www.prototypefund.de/uploads/Publikationen_und_Onepager/ApplicationGuide.pdf
- Prototype Fund FAQ: https://www.prototypefund.de/faq/
- Software infrastructure funding area:
  https://www.prototypefund.de/software-infrastruktur
- GitHub sub-issues and dependencies:
  https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues
- OpenProject work-package relations and hierarchies:
  https://www.openproject.org/docs/user-guide/work-packages/work-package-relations-hierarchies/index.html
- W3C PROV-O: https://www.w3.org/TR/prov-o/
