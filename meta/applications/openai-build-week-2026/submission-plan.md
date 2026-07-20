# Submission Plan

Deadline: July 21, 2026 at 5:00 PM PT.

## Build Week Scope

The new work must be a coherent extension completed during the official
submission period:

- visible aim-to-commit implementation provenance;
- dependency and goal context adjacent to the implementation evidence;
- a clean Codex workflow that reads an aim, performs work, and records the aim
  identifier in the resulting commit;
- judge-ready installation and test path;
- explicit documentation separating existing Aimparency capabilities from the
  Build Week extension.

## Product Acceptance Test

A judge can:

1. Open a repository in Aimparency.
2. Inspect a development aim and its parent/dependency context.
3. See code commits that reference and realize that aim.
4. Open enough commit detail to verify the code output.
5. Understand how Codex obtained the context through MCP.
6. Reproduce the workflow from concise instructions.

## Required Evidence

- [ ] Dated commits after July 13 isolate the extension.
- [ ] Commit messages reference the relevant Aimparency aim IDs.
- [ ] Primary Codex `/feedback` session ID is recorded below.
- [ ] Screenshots show the completed end-to-end workflow.
- [ ] Automated tests cover commit matching and the visible UI state.
- [ ] README identifies pre-existing work and new Build Week work.
- [ ] README explains human decisions versus Codex/GPT-5.6 contributions.
- [ ] Public repository and license are confirmed.
- [ ] Hosted demo, sandbox, or downloadable test build is available.
- [ ] Installation steps are tested from a clean environment.

Primary Codex session ID: `TODO: obtain with /feedback`

## Devpost Assets

- [ ] Title
- [ ] Short tagline
- [ ] English project description
- [ ] Technology list
- [ ] Public repository URL
- [ ] Public YouTube URL
- [ ] Square project image
- [ ] Screenshots
- [ ] Testing instructions
- [ ] Codex session ID
- [ ] Developer Tools category selected

## Demo Structure: Under Three Minutes

### 0:00-0:20 - Problem

AI coding agents can produce code quickly, but the repository loses the goal,
dependency chain, and evidence connecting intent to output.

### 0:20-0:45 - Product

Show the Aimparency graph stored beside the code. Select the Build Week aim and
show the goal and dependency context available to Codex through MCP.

### 0:45-1:35 - GPT-5.6 and Codex workflow

Show Codex retrieving the aim context, implementing a small but real change,
and associating the Git commit with the aim ID. Explain the human decisions:
the product framing, scope, and acceptance criteria.

### 1:35-2:20 - Traceability

Open the aim and show its realizing commit, status, and dependency context.
Inspect the commit to demonstrate that the evidence corresponds to code rather
than graph bookkeeping.

### 2:20-2:50 - Impact

Explain the audience: open-source maintainers and teams using coding agents.
Close with the portable Git-native loop from intent to verified implementation.

## Submission Copy Draft

### Tagline

Give Codex the why behind a change, then trace the code back to the aim.

### Description

Aimparency is a Git-native intent and dependency layer for AI-assisted
development. It stores a graph of goals, implementation aims, and dependencies
beside the source code and exposes that context to Codex through MCP.

During Build Week, we used GPT-5.6 through Codex, guided by Aimparency's own
graph, to add implementation provenance: an aim can now expose the code commits
that realize it while retaining the goal and dependency context that motivated
the work. This closes a loop that repositories and issue trackers leave open:
why an agent made a change, what it depended on, and where the resulting code
can be verified.

The project is aimed at open-source maintainers and agentic development teams
that need durable, reviewable context rather than disposable chat history.

## Go/No-Go Check

Submit only if the working workflow can be demonstrated clearly in under three
minutes and the new Build Week code is easy to distinguish. If the provenance
feature is incomplete, prioritize a smaller fully working path over a broad
platform tour.

