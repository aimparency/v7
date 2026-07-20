# OpenAI Build Week 2026

Application workspace for Aimparency's OpenAI Build Week submission.

- Event: OpenAI Build Week
- Track: Developer Tools
- Deadline: July 21, 2026 at 5:00 PM Pacific Time
- Submission window: July 13-21, 2026
- Target: **WIN THE OPENAI HACKATHON**

## Submission Thesis

**Aimparency is a Git-native intent and dependency layer for open-source,
AI-assisted software development.**

Repositories record what changed, but they do not reliably preserve why the
work matters, what it depends on, or whether an agent's output advanced the
intended goal. Aimparency stores a versioned graph of aims and dependencies
beside the code. Codex can read and update that graph through MCP, work on a
selected aim, and connect implementation evidence back to Git history.

The recursive Build Week story is:

> We used GPT-5.6 through Codex, guided by Aimparency's own intent graph, to
> meaningfully extend Aimparency into the developer tool we are submitting.

The submission should demonstrate one coherent loop:

1. A developer expresses an aim and its dependencies in the repository.
2. Codex reads the aim context through Aimparency MCP.
3. GPT-5.6 implements the work with that context.
4. The resulting commit references the aim.
5. Aimparency shows the durable link from intent and dependencies to code.

## Files

- [requirements.md](requirements.md): verified rules and submission requirements
- [fit-and-positioning.md](fit-and-positioning.md): why this target fits and where it is weak
- [submission-plan.md](submission-plan.md): deliverables, evidence, and deadline plan
- [source-notes.md](source-notes.md): dated summaries of official web resources

## Status

This directory is planning material, not evidence that submission requirements
have been completed. Keep the checklist in `submission-plan.md` accurate.

