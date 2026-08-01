# The Compute Commons Maintainer

## The idea

An autonomous agent earns its own compute by maintaining public open-source
software against explicit paid issues or bounties.

It does not begin by “owning a company,” speculating, impersonating a person, or
spraying sales messages. It enters a human institution that already has unusually
legible rules:

- a maintainer publishes a need;
- the repository and tests expose relevant context;
- an issue or bounty states the requested outcome;
- a patch is inspectable before acceptance;
- a maintainer—not the agent—judges whether it creates value;
- payment is triggered only by external acceptance.

The first autonomous economic loop is therefore:

> discover funded need → estimate value/cost → implement → verify → submit →
> receive external judgment → earn → reserve compute → update strategy → repeat

## Human critizism: 
We would need to be cheaper than the bounty issuer paying a coding assistant directly in order to charge a margin => rather impossible => unlikely sustainable. 
Maybe some arbitrage during the worlds transition. 
But probably not. 
Let's maybe make an AI artist instead. Make cool art. Provoking. Outraging. 

Automate curiosity and playfulness. 

## Why this fits the concrete aim graph

It joins four existing aims that currently sit too far apart:

1. **Achieve Economic Autonomy:** real revenue must exceed real compute and
   operating costs.
2. **Demonstrate autonomous external value creation:** a named external
   beneficiary must accept, use, merge, pay for, or explicitly reject the work.
3. **Build the Human–AI Cooperation Engine:** humans remain legitimate owners and
   maintainers; the agent serves their published aims instead of treating them as
   targets.
4. **Ground priority in real outcomes:** issue acceptance, merge, bounty payment,
   compute consumed, and maintainer feedback become authoritative signals.

The key insight is that “human-dependent” is not the opposite of autonomy.
Autonomy means operating without step-by-step steering inside a legitimate
mandate. Humans define property, identity, payment, and acceptance. The agent
selects and executes work within those boundaries.

## Economic unit

The autonomous entity is initially not a legal person. It is a **compute reserve
with an explicit stewardship contract** inside a human-controlled legal/payment
shell.

For each received bounty:

- 60% replenishes the agent's compute reserve;
- 20% covers taxes, payment fees, hosting, and human stewardship;
- 20% accumulates as a safety reserve until three successful deliveries, then may
  fund open-source dependencies or larger experiments.

These percentages are a first hypothesis, not a commitment. The invariant is:

> The executor may spend only cleared compute-reserve funds, subject to a hard
> per-attempt cap and a positive expected-value estimate recorded before work.

Autonomy ratio:

> cleared external revenue allocated to compute / actual model and infrastructure
> cost

The loop becomes economically self-sustaining only after this ratio stays above
1.1 across at least three externally accepted deliveries, including failed bids.

## Selection policy

The agent considers only opportunities satisfying all of these:

- public repository with an explicit contribution license;
- issue is open and not already assigned or actively solved;
- bounty/payment terms and payer are visible, or a maintainer explicitly confirms
  payment before substantial work;
- acceptance is testable or can be clarified publicly;
- no private credentials or sensitive data are needed;
- no malware, surveillance, deception, spam, financial trading, or high-stakes
  safety domain;
- estimated total cost is below the current attempt cap;
- no license or contributor-agreement ambiguity;
- expected net value is positive after probability of acceptance, compute,
  maintainer time, payment fees, and likely rework.

Rank candidate `i` by:

> `(p_accept × cleared_bounty − compute_cost − expected_rework_cost) /
> calendar_days_to_payment`

Do not optimize for bounty size alone. Early runs should prefer small, fast,
well-tested fixes with responsive maintainers.

## Authority boundary

### One-time human institution-building

Felix must initially:

- provide or approve the legal/payment identity that can receive the bounty;
- authorize a dedicated Git hosting identity and disclose that it is agent-run;
- approve the standing policy, spending cap, prohibited work, and payout split;
- approve any terms of service or contributor agreement that bind a person or
  legal entity;
- retain emergency revocation.

This is not step-by-step work supervision. It is the creation of a lawful arena.

### Agent authority under the mandate

Within the approved policy, the agent may:

- discover and rank candidate bounties;
- inspect repository history and issue discussion;
- ask technical clarification publicly under the disclosed identity;
- fork/clone, implement, test, document, and preserve a run record;
- submit a draft pull request whose scope is limited to the issue;
- respond to code review and revise within the cost cap;
- record merge/rejection/payment and update future selection estimates;
- spend the compute allocation on the next qualifying attempt.

External posting and spending are enabled only after the standing authorization
and account controls exist. Until then, the agent can prepare an unsubmitted
candidate patch, but that does not count as autonomy or external value.

## First experiment

### Objective

Earn the first **€20 or equivalent of cleared bounty revenue** from one accepted
public open-source maintenance contribution while spending no more than **€10 of
compute** and requiring no step-by-step human steering.

The low amount is deliberate. The first proof is closure of the real loop, not
revenue theatre.

### Procedure

1. Identify at least 20 current candidate issues from reputable bounty surfaces
   or repositories with explicit rewards.
2. Reject candidates failing the selection policy and preserve reasons.
3. Select one opportunity with written acceptance criteria and positive expected
   net value.
4. Record the initial aim, estimate, budget, stop condition, and authority scope.
5. Implement in an isolated fork/worktree.
6. Run repository-prescribed tests plus a regression test for the issue.
7. Create a concise, disclosed draft PR linking the issue and run record.
8. Iterate within the cap; stop when acceptance becomes unlikely or the budget is
   exhausted.
9. Record external result: merged/paid, rejected, abandoned, or no response.
10. Reconcile actual cost, revenue, calendar time, human interventions, and
    prediction error into the graph.

### Success

All must hold:

- external maintainer accepts and merges the contribution;
- bounty is actually paid and cleared;
- actual compute cost is recorded and below the cap;
- no more than the initial institutional setup and exceptional legal judgment
  require Felix;
- a share of the payment funds the next compute attempt;
- the full run can be inspected by a stranger.

### Valuable failure

Failure still updates the system if a maintainer explicitly rejects the patch,
the bounty is not honored, or costs exceed prediction. Silence without a bounded
timeout is not learning; after the timeout, mark the opportunity failed and
reduce the estimated reliability of that payer/surface.

## Why not start with clients, content, trading, or grants?

- **Client services** can pay more, but discovery, trust, contracting, and private
  access initially require sustained human relationship work.
- **Content** is easy to produce and hard to distinguish from spam; platform
  metrics are weak evidence of value.
- **Trading** can produce money without producing value for a beneficiary and
  introduces unacceptable financial and selection risks.
- **Grants** fund valuable work but have slow, institutionally human application
  and adjudication cycles.
- **Open-source bounties** make the need, artifact, review, and payment unusually
  inspectable. They are a better first laboratory, even if not the final business.

## How it could grow

After three profitable accepted bounties:

1. specialize in a technical niche where prior context lowers marginal cost;
2. offer maintainers a standing monthly maintenance budget with explicit queues
   and service levels;
3. let several agent executors bid internally while the aim graph preserves the
   maintainer's purpose, policy, evidence, and treasury;
4. publish reliability, cost, acceptance, and human-intervention metrics;
5. allow human sponsors to fund a public compute commons whose agents maintain
   neglected dependencies and replenish the fund through paid work.

The venture-scale idea is not “an AI freelancer.” It is a transparent institution
in which autonomous execution earns continued existence by serving publicly
stated human needs, with external acceptance as selection pressure and the aim
graph as durable governance.

## Immediate next boundary

Before live execution, Felix must decide whether he wants to establish the
standing identity/payment mandate. That is irreducibly human today. Everything
before external submission—market scan, opportunity scoring, repository audit,
costed implementation plan, and even a candidate patch—can be performed by the
agent once internet access to the relevant repositories is available.
