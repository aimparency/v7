# Fit and Positioning

## Why Aimparency Is a Credible Target

### Direct category fit

The Developer Tools track explicitly includes agentic workflows. Aimparency is
infrastructure for developers coordinating human intent, AI agents,
dependencies, and code in a repository.

### The product can demonstrate Codex use, not merely describe it

The strongest demo is self-referential but concrete: Codex reads an Aimparency
aim through MCP, implements it using GPT-5.6, cites the aim in Git, and the
product exposes the implementation evidence. That makes the required Codex
collaboration visible in both the product and the repository.

### Git-native intent is a specific problem

Issue trackers describe planned work and Git records code changes, but the
reasoning and dependency chain used by an agent often disappears between them.
Aimparency's opportunity is a portable, open, repository-local graph that both
humans and agents can inspect and evolve.

### Existing depth can help

The project already has a working graph, UI, MCP server, and agent tooling. That
allows Build Week effort to produce a meaningful end-to-end extension instead
of spending the week on scaffolding.

## Why the Commit-Provenance Feature Matters

A list of commits is not a winning idea by itself. Its value is as the final
proof step in this workflow:

`intent -> dependency context -> Codex work -> Git output -> visible evidence`

For the demo, the view should answer:

- What goal was the agent trying to advance?
- What parent aims or dependencies constrained the work?
- What code output was produced for this aim?
- Can a reviewer inspect that output in Git?
- Is the aim complete, partially realized, or unsupported by implementation?

This is stronger than generic AI task management because the graph lives with
the source and the result is reconciled against repository history.

## Honest Weaknesses

### Very high competition

The event page shows roughly 41,000 participants. That number includes
registrations, not necessarily eligible completed submissions, so it cannot be
used to calculate the true odds. It does mean the first seconds of the demo and
the clarity of the concept matter heavily.

### Pre-existing project burden

Only the post-July-13 extension will be judged. A large existing codebase can
make the new contribution hard to identify. The repository and demo need a
precise "before / Build Week extension / result" narrative.

### Product breadth

Aimparency currently spans planning, graphs, agents, and multiple interfaces.
The submission will become vague if it attempts to explain the whole platform.
The Build Week story must stay focused on Git-native intent for agentic
development.

### Evidence could look circular

"We used Aimparency to build Aimparency" is memorable, but it is not proof of
external value. The demo should use a realistic open-source development aim and
explain how a maintainer or contributor benefits.

## Positioning Decision

Proceed with the submission, but treat it as a time-boxed distribution and
product-clarity opportunity rather than a dependable funding plan.

Winning first place would meet the EUR 15,000 funding target only approximately
and prize receipt timing is uncertain. The Prototype Fund application and other
funding work should continue independently.

## One-Sentence Pitch

Aimparency is the Git-native intent graph that gives Codex the why and
dependencies behind a change, then links the resulting code back to the aim.

## Suggested Title

**Aimparency: Git-native intent for Codex**

