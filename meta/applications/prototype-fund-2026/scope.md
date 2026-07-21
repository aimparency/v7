# Fundable Prototype Scope

## Working Title

**Open protocol and tools for Git-native intent provenance**

## One Sentence

Develop a versioned open data protocol and independent command-line tools that
let software projects store goals, dependencies, rationale, and implementation
evidence in Git without depending on one AI assistant, issue tracker, or hosted
platform.

## Problem

AI-assisted software work produces code quickly, but the human intent behind
changes is fragmented across prompts, chats, issues, and proprietary services.
Repositories preserve what changed, not reliably why it mattered, which goals
it served, which dependencies constrained it, or whether an agent's claim of
completion has implementation evidence.

Issue trackers represent tasks well but do not provide a portable,
tool-independent protocol for:

- value-bearing goals and dependency graphs;
- rationale and human-dependent decisions;
- links from intent to commits and other implementation artifacts;
- local validation and migration;
- exchange between assistants and planning tools.

This creates lock-in and makes AI-mediated development difficult to inspect,
review, hand over, or continue with another tool.

## Users

Primary users:

- maintainers of open-source projects using coding assistants;
- small technical teams using multiple assistants or agent tools;
- developers building issue, planning, or agent integrations.

The first validation cohort should include at least five external repositories,
not only Aimparency.

## Public Value

The project strengthens user sovereignty in AI-assisted development:

- intent data remains local, diffable, and forkable;
- no hosted account or proprietary model is required;
- teams can change assistants without losing rationale;
- reviewers can inspect declared intent-to-code evidence;
- a shared protocol allows independent FOSS tools to interoperate.

This matches Prototype Fund's software-infrastructure focus: a reusable module
and standardized protocol implementation for developers, rather than an
end-user application. It also follows the program's stated preference for
modular, interoperable FOSS and alternatives to dominant technology vendors.

## Current Baseline

Aimparency already demonstrates:

- JSON files for aims, phases, dependencies, statuses, and rationale;
- Git storage and normal code-review workflows;
- graph and list interfaces;
- local MCP tools for reading and changing aims;
- Git commit scanning that can report commits referencing aim IDs;
- experimental semantic search and cross-repository boundaries.

These are proof that the problem can be represented. They are not yet the
funded result:

- there is no independent public protocol specification;
- the existing schema contains application and UI concerns;
- compatibility and migration guarantees are incomplete;
- provenance conventions are implicit and weakly validated;
- no standalone CLI supports adoption without Aimparency;
- interoperability has not been validated across external tools and projects.

## Funded Deliverables

### 1. Versioned protocol

- A minimal normative specification for aims, dependencies, rationale,
  lifecycle state, and provenance.
- JSON Schema or an equivalent machine-readable schema.
- Canonical ownership of graph edges, stable identifiers, extension points,
  and forward-compatibility rules.
- Explicit distinction between portable committed data and local runtime data.
- Migration rules and fixtures for supported protocol versions.

### 2. Standalone CLI

- Initialize protocol data in an existing Git repository.
- Validate syntax, references, graph integrity, and provenance records.
- Explain validation failures with actionable output.
- Migrate between supported versions.
- Query aims and dependencies without running Aimparency.
- Produce deterministic output suitable for CI.

### 3. Intent-to-implementation provenance

- A documented Git convention for associating commits with aims.
- Machine-readable evidence records for realization claims.
- Validation that referenced commits and aims exist locally.
- Clear semantics for claimed, verified, partial, and contradicted evidence.
- A privacy and threat analysis describing what provenance can and cannot
  prove without a central authority.

### 4. Interoperability toolkit

- A small typed library for reading and writing the protocol.
- Import/export adapter guidance.
- At least one independent adapter outside Aimparency, selected through user
  research, such as GitHub/GitLab issues or a generic JSON/CSV bridge.
- A reference Aimparency adapter that consumes the extracted protocol rather
  than defining it.

### 5. Validation and documentation

- Public conformance fixtures and automated tests.
- Five external repository trials.
- Installation, protocol, adapter, migration, and contribution documentation.
- A sustainability and governance proposal for protocol evolution.
- All funded outputs under accepted free/open licenses.

## Technical Questions

The prototype must resolve real uncertainty:

1. What is the smallest useful intent graph that remains expressive across
   different projects and tools?
2. How can graph edits merge predictably through ordinary Git workflows?
3. Which provenance claims can be verified locally without overstating trust?
4. How can adapters preserve useful semantics while acknowledging lossy
   mappings to issue trackers?
5. Which fields must remain optional or local to avoid exposing sensitive
   planning information?
6. How can the protocol evolve without forcing one application release cycle?

## Six-Month Shape

### Month 1: Research and protocol boundary

- User interviews and workflow examples.
- Extract the minimal model from application-specific state.
- Publish first specification draft and threat/privacy analysis.

### Month 2: Schema and conformance

- Machine-readable schema, semantic validator, fixtures, and version rules.
- Test Git merge behavior on representative graph changes.

### Month 3: CLI

- Initialize, validate, query, and deterministic CI output.
- Trial installation in two external repositories.

### Month 4: Provenance

- Git convention, evidence model, local verification, and failure semantics.
- Trial with real assistant-generated changes.

### Month 5: Adapters

- Typed library, one independent adapter, and Aimparency reference adapter.
- Trial in at least three additional repositories.

### Month 6: Hardening and release

- Migrations, conformance suite, accessibility/documentation review.
- External feedback, stable prototype release, governance and sustainability
  plan, public report, and demo.

## Explicit Exclusions

The grant would not fund:

- general maintenance of the existing Aimparency application;
- a redesign of its graph UI;
- building or training an AI model;
- a hosted SaaS, marketplace, or proprietary collaboration service;
- autonomous agent behavior or economic decision-making;
- bespoke integrations for one customer;
- routine feature work completed before the funding period.

## Success Criteria

By the end of funding:

- a repository can adopt the protocol without installing Aimparency;
- CI can validate the repository deterministically;
- at least two independent tools can exchange a useful subset of intent data;
- provenance evidence can be queried and its limitations are explicit;
- five external repositories have tested the prototype;
- at least two external maintainers state an intention to continue testing,
  integrating, or contributing.

## Application Risk

The weakest part of the case is currently user evidence. Technical scope alone
is insufficient. Before submission, validate the problem and protocol boundary
with external maintainers and obtain permission for concrete examples or pilot
commitments.
