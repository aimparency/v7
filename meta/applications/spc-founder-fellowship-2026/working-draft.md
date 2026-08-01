# SPC Founder Fellowship Fall 2026 — working draft

Status: working material for Felix + Boardy, 1 August 2026  
Deadline: 2 August 2026, 23:59 PT / 3 August 2026, 08:59 Berlin  
Official form: https://airtable.com/embed/appxDXHfPCZvb75qk/pag8h6Xe52XNke3ai/form  
Aim: `b52d435e-72b5-4839-b0cd-fbc916b46a03`

This is not submission-ready until Felix confirms every item marked **HUMAN**.

## The application in one sentence

Aimparency is an inspectable intent layer for autonomous AI: humans express what
should happen and why as a durable graph; interchangeable agents use that graph
to choose, execute, verify, and revise work without silently becoming the source
of authority.

## The founder insight

AI-native teams accumulate direction debt.

Models can already plan, code, call tools, and hand work to other models. But as
contexts and agents change, humans repeatedly reconstruct what matters, why it
matters, which trade-offs were already made, and which decisions remain theirs.
Prompts and chats compress rationale; issue trackers flatten it into tasks; and
the executing agent is implicitly asked to decide what is valuable. Better
models make this direction debt more consequential, not less.

Aimparency treats human intent as durable infrastructure. An aim is connected to
the aims it contributes to. Contribution weights express relative importance;
status makes human gates explicit; phases bind work to horizons; evidence and Git
commits connect claimed progress to outcomes. Agents remain replaceable. The
graph remains inspectable and amendable by the humans whose purposes it serves.

## Why this may be a company, not a feature

Every serious autonomous-agent system needs an answer to four questions:

1. Whose objective is authoritative?
2. How does a local task inherit context from a larger mission?
3. Which decisions may the machine make, and which require a human?
4. What evidence changes the shared understanding of what should happen next?

Today these answers are scattered across prompts, orchestration code, tickets,
chat transcripts, and individual memory. Aimparency's wedge is a local-first,
Git-native system for technical builders already coordinating long-running coding
agents. Its larger opportunity is to become the strategy and intent agent in a
network of specialist agents: model-independent infrastructure that preserves
direction, proposes bounded delegation, and reconciles returned evidence.

The initial commercial test is deliberately narrower: apply the same graph,
approval, and evidence primitives to one recurring workflow inside a real
organization, first as a productized implementation. The product question is
whether each subsequent implementation becomes materially faster because the
intent layer is reusable.

## Evidence we can honestly claim

- Aimparency is running open-source software, not a slide deck.
- It stores repository-owned graph state under `.bowman/` and exposes it to
  Codex, Claude, and Gemini through MCP.
- It supports aim/dependency editing, phase planning, semantic search,
  value/cost-informed prioritization, human-dependent states, reflections,
  model-backed aim proposals with explicit approval, and aim-to-Git evidence.
- The repository contains the real graph that directed its own development and
  several external applications.
- The OpenAI Build Week submission is public and shows the recursive use case:
  https://devpost.com/software/aimparency-the-aim-is-to-win
- Public demo: https://youtu.be/91JPjLPlXUM
- Public code: https://github.com/aimparency/v7
- The current SPC application has its own deadline phase and explicit human
  gates. Codex may draft and implement; it cannot choose Felix's commitments or
  submit personal representations.

Not yet evidence:

- customer willingness to pay;
- repeatable implementation economics;
- Robin's current co-founder commitment;
- acceptance into or winning any program;
- reliable coordination of independently operated A2A agents.

## Recursive proof: use carefully

Do not lead with “an AI wrote this application.” That is ordinary and weak.

The differentiated claim is operational: Felix set a consequential objective;
the graph preserved it across sessions and context compression; the system
decomposed agent-actionable work from human authority; Codex recovered official
requirements, created the deadline phase, implemented a missing transitive
priority view, verified it, and recorded the result; Boardy supplied external
critique; Felix retained control over personal facts, commitments, disclosure,
and submission.

The proof is falsifiable. A future executor should be able to enter the project,
read the aim context, see the decisions and human gates, and continue without
pretending the previous model's conversation is institutional memory.

## Exact live form fields recovered so far

The live form uses conditional sections. Felix has decided to select
`I'm exploring`; the questions rendered after that choice still need to be
copied verbatim. These fields were visible before selection:

1. Which best describes where you are in your journey today? **DECIDED: I'm exploring**
2. Where will you be based? **HUMAN**
3. How did you hear about the application? **HUMAN**
4. What personal or professional product, project, or achievement are you most
   proud of? Link and explain it. Required; under 1,000 characters.
5. Share 2–3 artifacts that illustrate your ability to do high-quality work.
   Required; under 1,000 characters.
6. Permission to stay in touch.
7. Anything else to add?

The company/founder conditional fields must be copied from Felix's rendered form
before finalization. Do not rely on third-party field lists.

## Draft: proudest achievement (under 1,000 characters)

The current 783-character answer lives under `PROUD` in
`submission-assembly.md`. It connects Felix's experienced problem to the working
system instead of leading with a feature inventory. Confirm the autobiographical
premise and authorship wording before submission.

## Draft: 2–3 artifacts (under 1,000 characters)

1. Aimparency: https://github.com/aimparency/v7 — the full local-first intent
graph, MCP tools, UI, and autonomy runtime. The interesting artifact is not only
the code but the `.bowman` graph beside it: inspectable intent connected to the
work it produced.

2. Recursive Build Week experiment:
https://devpost.com/software/aimparency-the-aim-is-to-win — I gave the system a
real external objective, let Codex execute through the graph, retained human
approval and submission authority, and exposed the result to an outside jury.

3. **HUMAN: choose a non-Aimparency artifact.** Prefer something that reveals a
different dimension of Felix's ability—live generative visuals, a shipped client
work, or the conversational AI therapist built with Robin—with a public link and
precise account of Felix's contribution.

## Draft: “anything else”

The current 723-character answer lives under `OTHER` in
`submission-assembly.md`. It makes one narrow continuity claim, names its limits,
and ends with the external paid test. Delete it if another answer already uses
the same proof.

## Human decisions for the 15:00 session

1. **DECIDED:** Felix selects `I'm exploring`; this is the clearly truthful
   current-stage answer. Confirm what conditional SPC path and questions this
   reveals, and pressure-test the consequence for the original funding aim.
2. Can Felix commit full-time and work from SF, NYC, or Bangalore for the
   eight-week bootcamp? Which office?
3. Is Robin a committed co-founder, a prospective collaborator, or neither for
   this application?
4. What is Felix's strongest non-Aimparency artifact with a public link?
5. Which biographical facts are both true and useful: programming since age 11,
   professional roles, education, festival/live-visual work, client outcomes?
6. What has Felix rejected or changed his mind about? SPC explicitly values how
   founders generate and discard ideas.
7. What is the venture-scale global maximum: developer intent infrastructure,
   strategy agent for multi-agent systems, or constitutional layer for autonomous
   organizations? Pick one spine; describe the others as expansion, not three
   companies.

## Claim ledger

| Claim | Current evidence | State |
| --- | --- | --- |
| Working open-source product | repository, tests, public demo | verified |
| Model-independent graph access | MCP integration and agent adapters in repo | verified |
| Intent-to-code evidence | Build Week implementation and docs | verified |
| Human gates guide this application | SPC phase + human-dependent child aims | verified |
| Transitive human-gate priority view | focused tests + frontend type-check | verified |
| Felix built Aimparency | repository history supports substantial work; exact authorship wording needs Felix | HUMAN |
| Programming since age 11 | prior draft only | HUMAN |
| Robin is co-founder | conflicting/old project material | HUMAN |
| Customer demand | no paid pilot yet | unsupported |
| Venture-scale repeatability | thesis, not evidence | hypothesis |
