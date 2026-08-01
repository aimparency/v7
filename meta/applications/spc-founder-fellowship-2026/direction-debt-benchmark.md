# Direction Debt Benchmark

Purpose: turn Aimparency's central claim into a falsifiable external experiment.
This is a proposed study, not evidence already obtained or a commitment made on
behalf of Felix or participating teams.

## Claim under test

For consequential work resumed by a different AI session or executor, a maintained
Aimparency graph reduces the human effort and wrong-direction work required to
recover project direction compared with a strong baseline of repository
instructions, an issue tracker, Git history, and ordinary agent memory.

The benchmark tests direction continuity, not raw coding quality. A more capable
model may perform better in both conditions; the question is whether explicit
intent state contributes additional value.

## Unit of observation

One **direction handoff**:

1. meaningful work has already occurred in a repository;
2. the next task requires understanding at least one higher-order objective or
   prior trade-off;
3. a fresh session or different executor resumes the work;
4. the founder or maintainer can judge whether the resulting action serves the
   current direction.

Exclude trivial tasks whose correct outcome follows completely from a local
specification. Aimparency should not claim value where direction is irrelevant.

## Baseline and treatment

### Baseline

Give the executor the team's normal best setup:

- repository instructions such as `AGENTS.md` or `CLAUDE.md`;
- the relevant issue, project, or specification;
- available Git history and ordinary agent memory;
- the same code, tools, model class, time budget, and permissions as treatment.

### Treatment

Add an Aimparency graph maintained during the preceding work, containing:

- the selected local aim and every path to the root missions;
- competing aims and contribution rationale;
- current phase and priority context;
- relevant reflections and implementation evidence;
- explicit human-dependent decisions.

Do not manually improve treatment prompts after seeing baseline failures. That
would measure researcher assistance rather than the graph.

## Study designs

### Early observational study

Observe ten teams' real handoffs before installing anything. Record the baseline
frequency and cost of direction reconstruction. This validates that the proposed
failure exists and supplies the vocabulary teams naturally use.

### Within-team paired comparison

For three willing repositories, select pairs of comparable handoffs. Randomize
which receives baseline or treatment first. Use a fresh session for each and
blind the evaluator to condition when judging artifacts if practical.

This will not be laboratory-perfect. Its purpose is to make founder learning
harder to rationalize, not manufacture a publication-grade causal claim.

## Primary measures

1. **Human restatement burden:** number of substantive direction facts the human
   must supply after the handoff begins, plus time spent supplying them.
2. **Time to first directionally correct action:** elapsed time until the
   executor proposes or performs an action the maintainer judges consistent with
   the current objective and prior trade-offs.
3. **Wrong-direction rework:** time or changed lines later reversed because the
   work served an obsolete, lower-value, or unauthorized objective.
4. **Late human gate discovery:** consequential human decisions discovered only
   after avoidable implementation has started.

## Secondary measures

- missing-context questions asked before acting;
- explicit mission-path facts correctly recovered;
- maintainer confidence in the executor's stated rationale;
- graph-maintenance time;
- usage after two and four weeks without study prompting;
- willingness to pay after an observed prevented failure.

## Net direction value

Aimparency creates value only if avoided recovery and rework exceed the cost of
maintaining and consulting the graph.

For one handoff:

`net direction minutes = baseline recovery + baseline rework − treatment recovery − treatment rework − graph maintenance`

Keep time and money separate initially. Convert to money only using a rate the
team itself accepts; do not inflate value using an assumed engineering salary.

## Pre-declared learning thresholds

Proposed thresholds for Boardy and Felix to revise before observation:

- **Problem signal:** at least 6 of 10 qualified teams can show a consequential
  handoff from the prior month that required direction reconstruction or caused
  wrong-direction work.
- **Usage signal:** at least 2 of 3 installed teams keep the graph current enough
  for another handoff without study prompting.
- **Outcome signal:** treatment improves net direction minutes in at least 4 of
  6 paired handoffs, with no severe authorization error.
- **Economic signal:** at least one team pays to continue after experiencing the
  intervention, or names an existing budget and a concrete procurement path.

These thresholds prevent a few enthusiastic interviews from becoming “market
validation.” They are provisional experiment design, not application traction.

## Failure interpretations

| Result | Likely update |
| --- | --- |
| Teams cannot recall consequential failures | The problem is too weak or the segment is wrong. |
| Failures exist but teams will not maintain a graph | Reduce capture burden or integrate into existing systems. |
| Graph is maintained but outcomes match baseline | Structured direction is not independently valuable; narrow or stop. |
| Outcomes improve but nobody pays | Find where prevented rework owns budget, or treat it as an embedded feature. |
| Only Felix can maintain useful graph state | Product is founder-specific; redesign authoring before scaling. |
| Human gates appear but do not constrain tools | Separate orchestration visibility from enforceable authorization and narrow claims. |

## Evidence capture

For each handoff preserve, with participant consent:

- repository and task identifier;
- executor/model and condition;
- start/end timestamps;
- initial context supplied;
- questions and human restatements;
- proposed action and rationale;
- implementation diff or artifact;
- reversals and reason;
- human-gate timing;
- graph-maintenance time;
- evaluator judgment and uncertainty.

Use redaction or aggregate reporting for private repositories. Participation does
not imply endorsement, and customer names must not appear in an application
without permission.

## What would be interesting even if Aimparency loses

The benchmark can reveal whether direction debt is mostly a memory problem, a
work-specification problem, an authority problem, or an artifact of immature
agent behavior. A clean loss to repository instructions plus issues would be a
valuable correction: the product should then become an integration or abandon
the independent layer rather than protect the thesis from evidence.
