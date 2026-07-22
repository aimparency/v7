# AI Autonomy Transformation Diagnostic

## Purpose

Give an owner a useful map of where AI autonomy can create measurable value in
their company without surrendering authority or automating unsafe work. The
diagnostic ends with a ranked roadmap and one bounded pilot candidate. It does
not promise an "autonomous company" before evidence exists.

## Required outputs

1. Owner mission, non-negotiables, and explicit decision rights.
2. Current value streams and their actual economics.
3. A graph of recurring decisions, work, dependencies, and evidence sources.
4. A ranked portfolio of candidate autonomous loops.
5. A reversible pilot with baseline, budget, stop condition, and owner sign-off.
6. A list of reusable Aimparency capability versus client-specific integration.

The owner keeps the graph and report even if no pilot follows.

## 1. Owner mandate

Record these before discussing automation:

- What must the company continue to make true for customers?
- What outcomes matter over 3, 12, and 36 months?
- What must never be optimized away?
- Which decisions may AI propose, execute, or never take?
- Which actions require owner, legal, financial, personnel, or customer consent?
- What loss would make the experiment unacceptable?

Decision rights use four levels:

| Level | AI role | Human role |
| --- | --- | --- |
| Observe | Collect and summarize evidence | Interpret |
| Propose | Recommend an action | Approve or reject |
| Execute reversibly | Act within budget and rollback boundary | Audit and intervene |
| Execute externally | Act toward customers/institutions | Explicit authorization unless separately delegated |

## 2. Economic baseline

Use authoritative source systems. Estimates must be marked as estimates.

| Measure | Baseline | Source | Observation window |
| --- | ---: | --- | --- |
| Revenue attributable to workflow | | Accounting/CRM | |
| Gross margin | | Accounting | |
| Staff and owner hours | | Time sample/interviews | |
| Cycle and response time | | Operational system | |
| Error, rework, refund, or failure cost | | QA/support/accounting | |
| Software, model, and integration cost | | Invoices/API billing | |
| Supervision and exception-handling cost | | Runtime log/time sample | |

No synthetic revenue, mock credits, tool-call count, or generated output volume
counts as value.

## 3. Value-stream and dependency map

For each customer-facing value stream, map:

- triggering event and desired outcome;
- recurring decisions and actions;
- required data and authoritative owner of that data;
- people, systems, suppliers, customers, and institutions involved;
- failure modes, maximum tolerable loss, and recovery path;
- current bottleneck and evidence supporting that diagnosis.

Represent outcomes as parent aims and candidate operating loops as supporting
aims. External systems remain authoritative; Aimparency stores intent,
dependencies, decisions, and evidence references.

## 4. Candidate loop card

Create one card per candidate:

| Field | Answer |
| --- | --- |
| Outcome served | |
| Current workflow and owner | |
| Trigger and completion condition | |
| Decisions/actions to automate | |
| Required tools, data, and credentials | |
| Human/institutional gates | |
| Baseline evidence source | |
| Expected upside and confidence | |
| Real implementation + operating cost | |
| Maximum loss and reversibility | |
| Verification method | |
| Stop condition | |
| Reusable product capability created | |
| Client-specific work created | |

## 5. Ranking

Score each dimension from 0 to 5 using cited evidence:

- `V`: expected annual economic value;
- `E`: evidence quality and observability;
- `R`: reversibility and bounded downside;
- `U`: reusable Aimparency capability produced;
- `C`: implementation and operating cost;
- `S`: ongoing human supervision burden;
- `D`: dependency/access risk.

Use the score only to structure judgment:

```text
pilot score = (V × E × R × (1 + U/5)) / (1 + C + S + D)
```

Show the raw evidence and assumptions beside the score. Do not let the formula
launder weak guesses into apparent precision.

## 6. Pilot readiness gates

A pilot is ready only when all are true:

- the owner approves the outcome, boundaries, and decision rights;
- a real baseline and authoritative evidence source exist;
- the loop is bounded, reversible, and economically meaningful;
- credentials and data access are explicitly authorized;
- budget, maximum loss, rollback, and stop condition are written;
- success includes all model, integration, supervision, and exception costs;
- the before/after comparison and review date are agreed in advance.

## 7. Roadmap

### Stage 0 — Diagnostic

Build the owner mandate, graph, baseline, and ranked loop portfolio. Sell this as
a standalone decision product.

### Stage 1 — Shadow operation

The loop observes and proposes while humans continue executing. Compare its
decisions with reality and correct the graph.

### Stage 2 — Reversible pilot

Delegate one bounded loop with logs, budget, rollback, and human gates.

### Stage 3 — Operational rollout

Expand only after verified net value. Add monitoring, incident handling,
ownership, and recurring economic review.

### Stage 4 — Company-level learning

Feed verified customer, operational, and financial outcomes back into the aim
graph. Retire failing loops, develop better hypotheses, and increase autonomy
only where evidence supports it.

## 8. Aimparency's own survival test

For every engagement track:

- cash received and collection time;
- model, integration, support, and founder costs;
- gross margin and renewal/continuation decision;
- founder hours and exception frequency;
- reusable versus client-specific implementation;
- time required to deploy the next similar client;
- revenue concentration and consequence of losing the client.

The transformation business is becoming autonomous only if client outcomes
remain useful while delivery margin, reuse, and resilience improve. Dependence
on one client, one founder, one provider, or repeated bespoke work is evidence
against the strategy and must change graph priority.

## Owner handoff

The diagnostic concludes with:

- the inspectable aim graph;
- a baseline evidence appendix;
- ranked loop cards, including rejected candidates and reasons;
- a 90-day roadmap;
- one pilot charter, or a documented recommendation not to automate yet;
- open assumptions and the next evidence that could change the decision.
