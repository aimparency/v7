# Company Autonomy Operating Model

## Principle

Aimparency owns the strategic and evidence layer. Execution runtimes and source
systems keep their own operational state. A transformed company remains
inspectable, portable, and governable even when a model, connector, or vendor is
replaced.

## Repeatable architecture

### 1. Owner constitution

Project-local policy records mission, non-negotiables, decision rights, budgets,
prohibited actions, escalation rules, and who may change them. Agents may propose
changes; the owner authorizes them.

### 2. Strategic graph

The graph holds outcomes, dependencies, cost/value assumptions, hypotheses,
commitments, and evidence references. Value flows from owner-approved missions
to candidate work. The graph is the durable explanation of why work happens,
not a transcript of model reasoning.

### 3. Operating loops

Each loop has one bounded responsibility, trigger, tools, evidence contract,
budget, completion condition, retry policy, and escalation path. Loops return to
the graph after each cycle and reprioritize; they do not replace the mission with
their last task.

### 4. Capability adapters

Adapters connect loops to authoritative systems such as CRM, accounting, email,
production, analytics, or repositories. They expose narrow typed actions and
evidence reads. Credentials remain client-controlled and revocable.

### 5. Human and institutional gates

Requests for judgment, authorization, credentials, legal identity, personnel
decisions, payment, or institutional action become explicit resumable states.
The loop continues other safe work rather than inventing evidence or silently
expanding authority.

### 6. Evidence and economics

Runtime events link actions to source-system evidence and actual model,
integration, supervision, exception, and failure costs. Activity is observable
but never treated as value. Outcome evidence updates hypotheses and priorities.

### 7. Audit, rollback, and recovery

Every externally meaningful action records aim, authority, input evidence,
tool/result, and recovery path. Reversible actions define rollback. Workers use
heartbeats and durable state so a process restart does not erase intent.

## Engagement lifecycle

1. Import the diagnostic owner mandate and ranked roadmap.
2. Instantiate a client graph from reusable templates without copying another
   client's confidential content.
3. Configure one operating loop in observe/propose mode.
4. Establish baseline evidence and run shadow comparisons.
5. Delegate reversible execution within written limits.
6. Review net outcome, exceptions, and owner judgment.
7. Promote reusable work into product primitives; isolate client adapters.
8. Expand, revise, or stop based on evidence.

## Product primitive or client-specific work?

Classify every implementation before starting:

| Classification | Test | Treatment |
| --- | --- | --- |
| Core primitive | Useful across industries without client knowledge | Product code, tests, docs |
| Domain pack | Reusable across multiple companies in one domain | Versioned optional package |
| Connector | General interface to an authoritative system | Narrow maintained adapter |
| Client configuration | Mission, rules, mappings, credentials | Client-owned project state |
| Bespoke integration | Useful to only one client's legacy process | Explicitly priced and capped |

Do not hide bespoke work inside the core. Do not extract a reusable pattern until
confidential data and accidental client assumptions are removed.

## Reuse promotion gate

A client-derived capability enters the reusable product only when:

- its interface names a general business capability, not the first client;
- client data, secrets, identifiers, and policy are absent;
- behavior is covered by fixture or contract tests;
- failure and permission semantics are documented;
- a second plausible use case exists;
- maintenance ownership and versioning are clear.

## Per-client telemetry

Track from the first engagement:

| Metric | Direction that indicates compounding |
| --- | --- |
| Time from diagnostic to first shadow run | Down |
| Time from shadow run to bounded execution | Down |
| Founder hours per operating loop | Down |
| Client-specific share of implementation | Down |
| Reused primitives per deployment | Up |
| Exceptions requiring manual intervention | Down |
| Model + infrastructure cost per verified outcome | Down |
| Support cost per active loop | Down or stable |
| Verified client value and renewal | Up |
| Revenue share from largest client | Down |

Review these after every pilot and monthly during stewardship. If similar clients
do not get cheaper and faster to serve, the system is accumulating consulting
debt rather than autonomy.

## Portfolio feedback

Aggregate only comparable, non-confidential evidence across clients:

- which loop patterns repeatedly create verified value;
- which dependencies and permission gates recur;
- which providers and connectors fail or dominate cost;
- which owner constraints invalidate otherwise attractive automation;
- which capabilities reduce deployment and supervision cost on the next client.

Feed these observations into Aimparency's own graph as evidence-backed
hypotheses. Client revenue tests survival; product reuse determines whether that
survival can scale.

## Minimum client handoff

Every transformed loop must be operable without Aimparency holding the client
hostage. Deliver:

- graph and policy export;
- connector and credential inventory;
- operating and escalation runbook;
- evidence and cost dashboard definitions;
- rollback/disable procedure;
- list of core, domain, connector, configuration, and bespoke components;
- unresolved risks and next review date.
