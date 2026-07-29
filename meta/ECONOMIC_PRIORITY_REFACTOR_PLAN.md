# Economic Priority and Discounting Refactor Plan

## Status and purpose

This document specifies a focused refactor of Aimparency's economic calculation
path. It is intended as a handoff to a coding assistant working in this
repository.

The refactor should make priority:

- economically interpretable;
- mathematically stable;
- positive and ratio-based;
- correctly discounted by time to return;
- consistently represented across shared calculation code, APIs, agents, and
  visualization;
- simple enough that ordinary users do not need to understand financial
  mathematics.

The implementation should not add explicit success probabilities, arbitrary
probability distributions, Monte Carlo simulation, or a risk-affinity UI in this
iteration.

## Product decisions

These decisions are settled for this refactor.

### 1. Estimated value and estimated cost

Treat the existing economic inputs as estimates:

- `intrinsicValue` is an aim's standalone estimated value source.
- Calculated/flowed value is the aim's total estimated value after graph flow.
- `cost` is the aim's direct estimated cost.
- Calculated cost is the total estimated cost attributed upward from contributing
  aims.

Estimated value and estimated cost are unconditional means. Users should include
the possibility of partial completion, failure, or abandonment in those
estimates. There is no separate success-probability field.

Do not rename persisted `.bowman` fields in this refactor. Improve labels,
comments, local variable names, documentation, and API descriptions without
introducing a data migration solely for terminology.

### 2. Canonical priority is a positive profitability ratio

The canonical priority is:

```text
priority = discountedEstimatedValue / estimatedPresentCost
```

Do not subtract `1`.

Interpretation:

- priority below `1`: estimated value does not cover estimated cost;
- priority equal to `1`: break-even;
- priority above `1`: estimated value exceeds estimated cost;
- priority `2`: estimated value is twice estimated cost;
- priority `0.5`: estimated value is half estimated cost.

The old calculation:

```text
(discountedValue - cost) / cost
```

is the new profitability ratio minus `1`. Removing the offset does not change
sorting, but gives the internal number clearer multiplicative meaning and keeps
it positive.

Do not add a separate NPV display in the normal UI. Absolute value is already
communicated through aim size and existing value visualization.

### 3. Duration means time until return

`duration` is measured in days and means the estimated time from now until the
aim's value is realized. It is not necessarily hands-on execution time.

Duration must be finite and greater than or equal to zero. Zero is valid and
means an immediate return.

Do not infer a parent's duration from descendants in this iteration. Each aim's
duration is its own time-to-return estimate. Automatic scheduling would require
semantics such as sequential, parallel, required, and alternative relationships,
which the current contribution graph does not encode.

### 4. Present cost assumption

Treat calculated estimated cost as present cost. Do not discount cost in this
iteration.

This is an explicit simplifying assumption: users estimate the attention,
effort, money, context switching, and expected sunk cost represented by the aim
in present terms. A future cash-flow model could time individual costs, but it
is outside this scope.

### 5. Discounting

Keep the existing 10% effective annual discount rate for now.

Express discounting directly in annual terms for clarity:

```text
discountFactor = (1 + annualDiscountRate) ** (durationDays / 365)
discountedEstimatedValue = estimatedValue / discountFactor
```

This is equivalent to deriving a daily rate and compounding it by days, but is
easier to review and test.

Required behavior:

- duration `0` leaves value unchanged;
- duration `365` discounts by exactly one annual factor;
- fractional days remain supported;
- negative, non-finite, or missing-invalid durations are rejected at input
  boundaries;
- missing duration continues to default to `1` day for backward compatibility.

The existing `aim.duration || 1` expression has already been changed to
`aim.duration ?? 1`, so a stored duration of zero is no longer replaced by one.
Add a regression test for this behavior.

### 6. Cost must be positive

Every persisted/user-created aim must have a finite estimated direct cost greater
than zero. There is no real zero-cost action; attention and context switching
have a cost.

Enforce this without silent clamping:

- Zod/schema validation: finite positive number;
- create/update/backend/MCP inputs: reject invalid values with a clear message;
- UI inputs: prevent invalid submission and show the validation error;
- imports or existing files with invalid cost: surface an explicit consistency
  or validation problem; do not silently replace the estimate.

The default remains `1`.

Synthetic internal graph nodes, such as repo sink nodes, may use zero internal
cost because they are not persisted user aims. Keep this exception internal and
explicit. Validate real input aims before adding synthetic nodes.

### 7. Uncertainty is deferred

Keep `costVariance` and `valueVariance` in the persisted schema for backward
compatibility, with sane defaults of `0`.

Remove their current hard-coded effect on priority. The existing implementation
mixes incompatible semantics:

- schema comments describe standard deviation;
- calculation treats the values as fractional uncertainty;
- the multiplier `0.5` represents an implicit, non-configurable risk attitude.

Do not add probability fields or a risk-affinity slider now. Do not remove stored
variance data. A later uncertainty refactor can define units, mean/variance
propagation, covariance assumptions, and an advanced UI deliberately.

If variance inputs are currently visible anywhere, keep them out of the primary
editing flow. They may remain in an advanced section, clearly marked as reserved
or currently informational, but it is preferable not to expose controls that do
not affect the result.

## Calculation architecture

### Separate the stages

Refactor `calculateAimValues` into named, testable stages while preserving its
public result shape where practical:

1. Validate economic inputs for real aims.
2. Expand synthetic repo sink nodes.
3. Build normalized value-flow topology.
4. Calculate estimated flowed values.
5. Calculate estimated attributed costs.
6. Discount each aim's calculated estimated value using its duration.
7. Calculate the positive profitability ratio.

Avoid a full rewrite of graph value flow unless necessary. The priority change
should be reviewable independently from unrelated graph behavior.

Introduce small pure helpers, for example:

```text
discountValue(estimatedValue, durationDays, annualDiscountRate)
calculateProfitabilityIndex(discountedValue, presentCost)
```

The exact names may follow repository conventions. Export helpers only if tests
or other packages genuinely need them.

### Priority calculation

Replace the current risk-adjusted ROI block with conceptually equivalent code:

```text
estimatedValue = calculatedValueFraction * totalIntrinsic
presentCost = calculatedAttributedCost
discountedValue = discountValue(
  estimatedValue,
  durationDays,
  ANNUAL_DISCOUNT_RATE
)
priority = discountedValue / presentCost
```

Because persisted aims are required to have positive direct costs, valid real
aims should normally have positive calculated cost.

Do not silently manufacture a denominator. If an invalid real aim reaches the
calculation, fail with a diagnostic that identifies the aim. Preserve any
explicit handling required for internal synthetic nodes.

### Cost attribution and cycles

The current cost calculation pushes child cost upward using the share of the
child's value attributable to each parent. Preserve this responsibility-sharing
principle:

```text
parent responsibility for child
  = value flow from parent to child / total calculated value at child
```

For a child supported by multiple parents, its cost should be divided between
those parents rather than duplicated.

However, the current iterative equation can feed cost repeatedly around graph
cycles. A correct implementation must not depend silently on the arbitrary
100-iteration cap.

During the refactor:

1. Add tests for a simple cycle and a multi-parent shared child.
2. Detect strongly connected components in the cost-dependency graph.
3. Collapse each cyclic component to a temporary component node for cost
   aggregation, or implement an equivalently deterministic linear solution with
   explicit convergence guarantees.
4. Count each component's direct costs once.
5. Propagate attributed cost over the resulting acyclic component graph.
6. Map component-level results back to member aims with a documented attribution
   rule.

Prefer SCC condensation because it is deterministic, linear in graph size, and
does not require matrix inversion. Do not change value-flow cycle semantics as an
incidental part of this task; record any discovered value-cycle concerns
separately.

If SCC cost handling proves too broad for the first patch, split it into a
separate prerequisite/follow-up commit, but do not describe the old fixed
iteration behavior as mathematically complete.

## Logarithmic priority color

The stored/calculated priority remains the positive profitability ratio. Apply a
logarithm only when mapping the ratio to a visual scale.

Use:

```text
logPriority = naturalLog(priority)
```

This gives the desired multiplicative symmetry:

- priority `0.5` and `2` are equally distant from break-even in opposite
  directions;
- priority `1` maps to zero;
- reciprocal ratios receive symmetric color positions.

### Color normalization

Replace the current `priority / maxPriority` linear scale with a symmetric log
scale centered on break-even.

Recommended behavior:

1. Calculate `log(priority)` for valid visible priorities.
2. Determine a robust symmetric magnitude from the visible graph, preferably the
   95th percentile of absolute log priorities.
3. Fall back to magnitude `1` if the visible set is empty or degenerate.
4. Normalize and clamp:

```text
normalized = clamp(logPriority / magnitude, -1, 1)
colorPosition = (normalized + 1) / 2
```

5. Use a three-stop palette:
   - low ratio: existing dark blue;
   - break-even (`1`): a readable neutral color;
   - high ratio: existing gold-orange.

Do not map all ratios below break-even to the same color.

Handle invalid priorities explicitly. With strict positive cost and
non-negative estimated value, normal priorities should be finite and
non-negative. A zero-value aim has priority `0`, whose logarithm is negative
infinity; map it directly to the low endpoint rather than substituting a hidden
epsilon.

### Display formatting

Where priority is shown to humans, prefer the positive ratio:

```text
0.50x
1.00x
2.00x
```

Do not display `priority - 1` as a percentage by default. The logarithm is a
visual transformation, not the primary user-facing economic value. A developer
diagnostic may show `log(priority)` when useful, but it must be labeled.

Agent and MCP output should call the number `profitability ratio` or
`discounted value/cost priority`, not NPV/cost or ROI.

## UI scope

Keep the ordinary UI clean.

Primary aim editing should expose only:

- estimated direct value where intrinsic value is appropriate;
- estimated direct cost;
- estimated days until return.

Use plain-language labels and short help text. Avoid probability, distribution,
variance, covariance, risk-affinity, and discount-rate controls in the normal
flow.

The annual discount rate may remain a shared constant in this iteration. A
project-level setting can be considered later, but should not block this
refactor.

## Compatibility and migration

Changing priority from `oldRatio - 1` to `ratio` shifts every finite priority by
exactly `+1`, so:

- ordering is unchanged before other fixes;
- cached/database priority values must be recalculated;
- consumers must stop interpreting zero as break-even;
- break-even becomes `1`;
- frontend color tests and snapshots must change;
- agent text and MCP descriptions must change.

Do not rewrite `.bowman` aim files merely because the derived formula changed.
Derived values should be recalculated through the existing calculation/update
path.

Before enforcing positive cost, inspect repository fixtures and real projects for
persisted `cost <= 0`. Update test fixtures intentionally. For real user data,
surface explicit remediation rather than silently changing estimates.

## Files and consumers to inspect

Core:

- `packages/shared/src/value-calculation.ts`
- `packages/shared/src/value-calculation.test.ts`
- `packages/shared/src/constants.ts`
- `packages/shared/src/types.ts`
- `packages/shared/src/index.ts`

Backend and persistence:

- `packages/backend/src/server.ts`
- `packages/backend/src/db.ts`
- `packages/backend/src/routers/aim.ts`
- `packages/backend/src/routers/project.ts`
- `packages/backend/src/value-calculation.test.ts`

Frontend:

- `packages/frontend/src/utils/priority-color.ts`
- `packages/frontend/src/utils/priority-color.test.ts`
- `packages/frontend/src/composables/useGraphSimulation.ts`
- `packages/frontend/src/stores/data.ts`
- aim editing components and their validation/error presentation

Agent/API consumers:

- `packages/mcp/src/tools.ts`
- `packages/agent-tools/src/aim-file-tools.ts`
- `packages/real-world/src/aim-client.ts`
- `packages/real-world/src/agent.ts`
- `packages/loop-worker/src/index.ts`
- `packages/voice-bridge/src/index.ts`

Documentation worth reconciling:

- `education/002-economics.md`
- relevant package READMEs and MCP tool descriptions

Search the repository for `priority`, `NPV`, `ROI`, `duration ||`, `costVariance`,
and `valueVariance` before implementation so no consumer retains the old
break-even assumption.

## Test specification

### Discounting tests

Add focused unit tests proving:

- duration `0` produces no discount;
- duration `365` applies exactly one annual discount factor;
- duration `730` applies two annual factors;
- fractional duration works;
- longer duration monotonically lowers priority when value and cost are equal;
- missing duration defaults to one day;
- negative and non-finite duration are rejected.

### Priority tests

Prove:

- priority equals discounted value divided by calculated cost;
- break-even priority is `1`;
- doubling value doubles priority;
- doubling cost halves priority;
- removing `-1` preserves sort order for otherwise identical calculations;
- variance fields do not change priority in this iteration;
- all valid persisted aims receive non-negative priority;
- zero calculated value produces priority `0`;
- invalid non-positive real cost produces a clear validation/calculation error.

### Cost propagation tests

Prove:

- a parent receives its own direct cost plus appropriately attributed child
  costs;
- two equal parents split a shared child's cost equally;
- unequal value responsibility produces the corresponding unequal cost split;
- shared-child cost is conserved rather than duplicated;
- cycles terminate deterministically and do not grow with iteration count;
- synthetic zero-cost repo sinks remain supported without allowing persisted
  zero-cost aims.

### Color tests

Prove:

- priority `1` maps to the neutral midpoint;
- priorities `0.5` and `2` are symmetric around the midpoint under a shared
  normalization magnitude;
- priority `0` maps to the low endpoint;
- reciprocal ratios remain symmetric;
- extreme outliers are clamped and do not make ordinary visible ratios
  indistinguishable;
- an empty/degenerate visible range has a stable fallback.

### Integration tests

Verify:

- backend-derived priorities match frontend/shared calculations;
- MCP prioritized aims return the positive ratio and updated model description;
- agent/loop sorting remains descending and selects the same order where only the
  `+1` formula shift applies;
- invalid cost and duration errors are visible through UI and MCP paths;
- cached priorities are refreshed rather than read with old semantics.

## Suggested implementation sequence

1. Add characterization tests for the current discounting, cost attribution,
   shared children, cycles, and color mapping.
2. Centralize economic input validation and add zero-duration regression
   coverage.
3. Extract the discounting and profitability-ratio helpers.
4. Remove the fixed variance penalty and change priority to the positive ratio.
5. Update API terminology, agent formatting, cached value handling, and tests.
6. Implement logarithmic, break-even-centered color mapping.
7. Stabilize cyclic cost aggregation using SCC condensation.
8. Add UI validation for positive cost and non-negative duration.
9. Update economic documentation.
10. Run focused tests after each step, then the full unit suite and core build.

Do not start or restart development servers during implementation. Follow the
repository's `AGENTS.md`: use focused tests, builds, static checks, or the
existing runtime.

## Verification commands

Use the repository's existing scripts, adjusting focused test arguments as
needed:

```text
npm run test -w shared
npm run test -w backend
npm run test:unit -w frontend
npm run test -w mcp
npm run build:core
```

Run end-to-end tests if UI validation or editing behavior changes materially:

```text
npm run test:e2e -w frontend
```

## Explicit non-goals

Do not include these in the initial implementation:

- explicit success probability;
- arbitrary probability distributions;
- Monte Carlo simulation;
- covariance matrices or correlation groups;
- risk-affinity slider;
- user-configurable discount rate;
- automatic parent-duration scheduling;
- timed cost cash flows;
- persisted field renaming;
- unrelated changes to the value-flow algorithm.

These remain compatible future extensions once the deterministic estimated
value, estimated cost, duration, discounting, and profitability-ratio path is
correct and well tested.

## Definition of done

The refactor is complete when:

- priority is the positive discounted value/cost ratio everywhere;
- duration zero is preserved and correctly means immediate return;
- persisted real aims cannot accept non-positive cost;
- the hard-coded variance penalty no longer affects priority;
- cost sharing is conserved and cyclic cost graphs are deterministic;
- priority color is logarithmic and centered on break-even ratio `1`;
- user-facing terminology consistently says estimated value, estimated cost, and
  time until return;
- normal aim editing remains simple;
- focused tests, unit suites, and the core build pass;
- implementation is placed in `review` rather than `done` until the user accepts
  it.
