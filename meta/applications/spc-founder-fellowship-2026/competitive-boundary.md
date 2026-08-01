# Competitive boundary: why memory, orchestration, and task systems are not enough

First-party capabilities checked 1 August 2026:

- Claude Code memory: https://code.claude.com/docs/en/memory
- GitHub Copilot repository instructions:
  https://docs.github.com/en/copilot/how-tos/configure-custom-instructions-in-your-ide/add-repository-instructions-in-your-ide
- LangGraph persistence:
  https://docs.langchain.com/oss/python/langgraph/persistence
- Linear Agent: https://linear.app/docs/linear-agent
- Linear agents: https://linear.app/docs/agents-in-linear

Purpose: answer “isn't this agent memory, orchestration state, or project
management?” fairly. Adjacent products are capable and evolving. Aimparency must
earn a distinct job, integrate where appropriate, and be abandoned if the job
does not matter independently.

## What adjacent systems already do well

### Repository instructions and agent memory

Claude Code persists human-authored project instructions and agent-authored
learnings across sessions. GitHub Copilot loads repository, path-scoped, and
agent instructions. These systems already reduce repeated explanation of build
commands, architecture, conventions, preferences, and workflow rules.

Aimparency therefore cannot win on “agents remember the repository.” Its claim
must concern structured, revisable direction: how local work contributes to
multiple purposes, which competing outcome has priority, where authority stops,
and which observed result changes the plan.

### Orchestration persistence

LangGraph checkpoints execution state and supports resumption, human interrupts,
time travel, fault recovery, and memory across threads. It is strong evidence
that durable agent state and human-in-the-loop execution are becoming standard
platform capabilities.

Aimparency therefore cannot win on “a workflow survives interruption.” Its
proposed layer sits above a particular execution graph: an institution can keep
its aims and evidence while replacing the model, orchestration framework, or
workflow implementation. LangGraph could execute work selected through
Aimparency rather than being displaced by it.

### Work management with agents

Linear represents initiatives, projects, milestones, issues, relationships,
documents, and history. Its agents can understand and update that workspace;
humans remain owners when work is delegated to agents.

Aimparency therefore cannot claim that ordinary trackers lack hierarchy,
relationships, history, or human ownership. Its narrower difference is a
many-parent contribution graph with value flowing from higher aims into possible
work, repository-owned state available to different executors, and explicit
reflection/evidence intended to revise priority—not merely report progress.

## The actual differentiation hypothesis

The relevant comparison is not features but authority over direction:

| System category | Durable object it primarily preserves | Aimparency's proposed additional object |
| --- | --- | --- |
| Agent memory/instructions | knowledge and behavioral guidance | contested aims, contribution, priority, and human decision boundaries |
| Workflow orchestration | execution/thread state | purpose that remains authoritative across workflow implementations |
| Project management | planned work and organizational progress | computable contribution from possible work to multiple higher purposes |
| Git | code and implementation history | why an outcome mattered and whether evidence should change direction |

The product succeeds only if this separate object changes behavior: fewer human
restatements, earlier escalation of human decisions, less wrong-direction work,
or better strategy revision. If memory plus an issue tracker produces the same
outcome with less ceremony, Aimparency should integrate, narrow, or lose.

## Defensible application wording

> Agent memory preserves facts and instructions; orchestrators preserve execution
> state; project tools preserve planned work. Aimparency attempts to preserve the
> direction those systems are meant to serve: how local work contributes to
> competing purposes, which decisions remain human, and what evidence should
> change priority. The distinction is a hypothesis, not a moat. I will test it
> against memory-plus-issues as the baseline and abandon or integrate the product
> if it does not reduce restatement and wrong-direction work.

## Claims to avoid

- “Task trackers are flat” without qualification; mature tools support hierarchy
  and relationships.
- “Other agents forget everything”; persistent instructions and automatic memory
  already exist.
- “Existing orchestrators cannot resume or involve humans”; checkpointing and
  interrupts already provide this.
- “Model independence is itself a moat”; open files and common instruction
  conventions reduce switching costs too.
- “The graph is authoritative” as a self-fulfilling claim. External teams must
  choose to maintain and rely on it.
