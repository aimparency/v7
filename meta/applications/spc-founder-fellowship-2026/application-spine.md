# Aimparency application spine

Purpose: one coherent argument from observed problem to venture-scale direction.
This is the source of truth for application answers; shorten it to fit each field
instead of mixing the three narratives in `narrative-options.md`.

## The memorable problem: direction debt

AI makes execution cheaper, but every long-running project accumulates
**direction debt**: the repeated work of reconstructing what matters, why it
matters, which trade-offs were already made, what evidence changed the plan, and
which decisions still belong to a human.

Today that state is fragmented across prompts, chats, issue trackers, Git,
documents, and people's memories. Context summaries compress it. Task lists
flatten it. Model-specific memory traps it inside the current executor. As agents
become faster and more interchangeable, locally competent work can diverge from
the purpose it was meant to serve more quickly.

## The product

Aimparency is repository-owned intent infrastructure. It represents aims as a
contribution graph rather than a flat task list, so a local action can inherit
the missions it serves. The graph stores priorities, time horizons, evidence,
reflection, and explicit human gates. Replaceable agents can recover this state,
choose bounded work, verify outcomes, and update the shared plan without becoming
the source of authority.

The smallest useful promise is:

> Change the executor without losing the project's direction.

## The first user and painful event

Start with a technical founder or small AI-native software team using coding
agents repeatedly on one consequential repository.

The painful event is not “agents need memory.” It is a handoff or resumed session
in which the human must reconstruct project direction, an agent performs a
locally reasonable task that no longer serves the current objective, or a human
decision is discovered only after machine work has proceeded.

Aimparency should win only if it reduces that reconstruction and rework enough
to outweigh the ceremony of maintaining the graph.

## Why existing tools are insufficient

- Chat memory remembers conversation, but the executing vendor controls its
  representation and replacement can destroy continuity.
- Issue trackers record work units, but not a computable contribution path from
  a task to competing higher-order purposes.
- Git preserves implementation history, but usually not why an outcome was
  valuable or which evidence should change priorities.
- Agent orchestrators route execution, but often treat the supplied objective as
  an input rather than durable, inspectable institutional state.

Aimparency does not need to replace these systems. It can be the authoritative
intent layer they read from and write evidence back to.

## Why now

The relevant discontinuity is not that models became intelligent enough to use
a graph. It is that execution is becoming abundant and replaceable while the
human capacity to restate, supervise, and legitimize direction is not. Better
agents increase the cost of unclear authority because they can travel farther
before a mistaken objective is noticed.

## Evidence today

Aimparency is working open-source software with repository-owned graph state, a
visual interface, model-neutral MCP tools, phase and priority machinery,
structured reflection, human-dependent states, semantic retrieval, and
aim-linked Git evidence. Adapters allow several model runtimes to work through
the same graph.

The strongest narrow proof is continuity, not autonomy: after context changes, a
new Codex session can recover the SPC objective, its mission paths, deadline,
verified work, and unresolved human decisions from project state. During this
application, the run exposed a defect—human-dependent descendants were hidden
from a phase's priority view—and the executor implemented and tested transitive,
cycle-safe visibility under the same objective.

This proves a working coordination mechanism inside one founder-controlled
project. It does not prove customer demand, general alignment, secure
authorization, or autonomous organizations.

## The company path

1. Win repeated use in AI-native repositories by reducing direction
   reconstruction and wrong-direction work.
2. Become the stable strategy layer above changing models and specialist agents.
3. If trusted intent and evidence state generalize beyond software, support
   bounded organizational workflows in which authority and human relationships
   must remain explicit.

Each step is conditional on evidence from the preceding one. The third is a
possible consequence, not a present product claim.

## The eight-week falsification

Recruit ten qualified AI-native teams and observe a real resumed-session or
handoff failure in each. Install Aimparency in at least three live repositories.
For comparable work, measure:

- founder restatements needed before useful execution;
- delayed human decisions;
- work reversed because it served the wrong objective;
- whether the graph remains current without founder prompting;
- continued use after the novelty period.

Ask for payment once the intervention prevents or shortens an observed failure.
One paid continuation is positive evidence. Failure to maintain the graph,
failure to reduce reconstruction, or consistent refusal to pay is evidence to
narrow, integrate, or reject the wedge.

## The moat hypothesis

The moat is not graph data structures or an agent wrapper. It is trusted,
accumulated intent-and-evidence state plus the workflow by which humans and
multiple executors keep that state authoritative. This is only a hypothesis. It
becomes credible when teams retain the graph across model changes and permit it
to guide consequential work.

## The founder story still required

The product argument is now coherent, but the application cannot substitute it
for Felix's causal story. Human input must connect:

1. the repeated experience that made direction debt personally undeniable;
2. the unusual practice or artifact that enabled Felix to build this system;
3. a decision Felix changed when evidence contradicted his theory;
4. why Felix will endure the uncomfortable market test rather than only build;
5. Robin's actual present role, without implying commitment or endorsement.

## Language discipline

Prefer:

- direction debt;
- repository-owned intent;
- replaceable executors;
- inspectable human gates;
- evidence that revises priorities;
- continuity across handoffs.

Avoid unless directly evidenced:

- alignment solution;
- human sovereignty guarantee;
- operating system for agents;
- autonomous organization;
- customer traction;
- co-founder.

## Compression to three sentences

AI is making competent execution abundant, but long-running teams accumulate
direction debt: humans repeatedly reconstruct purpose, trade-offs, and authority
as contexts and agents change. Aimparency stores that intent as an inspectable,
repository-owned contribution graph through which replaceable agents can choose,
verify, and revise work while human decisions remain explicit. It works inside
its own development today; the next test is whether it measurably reduces
restatement and wrong-direction work in external AI-native repositories, and
whether anyone pays when it does.
