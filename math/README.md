# Value, cost and priority: a rethink

Implemented in `packages/shared/src/value-calculation.ts`. Its tests mirror
`examples.py`, and its results match `models.flow_reach` on the real projects
to within 1e-15.

```
python3 examples.py    # every model against hand-computed examples
python3 verify.py      # brute-force checks of the claims below on random graphs
python3 real_data.py   # current vs proposed on real projects
```

Needs numpy, scipy and networkx.

## What we want

- Value is estimated **top down**: we know what a big idea is worth, and how
  important its parts are (connection weights). The question is what each part
  is worth. Value is unitless and any scale works.
- Cost is estimated **bottom up**: what it takes to realize an idea, including
  its share of what it builds on.
- Priority = aggregated value / aggregated cost.
- Cycles are allowed, including closed ones that value can enter but never
  leave, and nothing may become infinite.
- Simple and elegant.

## Proposal: one matrix, two linear passes

`Q[x, y]` is the share of the value reaching `x` that `x` hands to `y`:
`weight / (self weight + Σ weights)`. The rest, `keep[x] = self weight / (…)`,
is realized at `x` itself. A leaf keeps everything.

```
top down    t = i + Qᵀ t        value passing through each idea  (i = intrinsic)
bottom up   κ = c / t + Q κ     cost per unit of that value       (c = direct cost)

value            = keep · t     realized at the idea; sums to Σ i
aggregated value = t            (= reach in cycles, see below)
priority         = 1 / κ
aggregated cost  = κ · aggregated value
```

It is still your flow simulation, with two changes. Pour `i` in every step,
pass everything on along `Q`, and the stream converges to `t`. What an idea
keeps leaves the stream as realized value instead of circling back through a
self loop. And no normalization is needed: kept value leaves, so nothing piles
up.

**Your example.** A has intrinsic value 2, self weight 5 and builds on B
(weight 5). Then `t = (2, 1)`, value `= (1, 1)` and
`κ_B = 1/1 = 1`, `κ_A = 1/2 + ½·κ_B = 1`. Priority is `(1, 1)` and aggregated
cost is `(2, 1)`.

### Why the cost pass is the right one

`κ` is the Leontief **price** dual to the **quantity** `t`. In input-output
economics, `x = (I−A)⁻¹y` gives quantities and `p' = v'(I−A)⁻¹` gives prices
from the same matrix. Here `Q` plays the role of the technical coefficients, so
`Q[x, y]` is "units of y's value per unit of x's value". `κ[y]` is one price per
idea, shared by every parent. Each parent pays `flow · κ[y]` for exactly the
value it routes through `y`, which is the attribution-share rule we shipped in
856fb26, now in consistent units.

`verify.py` checks this directly. `κ · aggregated value` equals the brute-force
cost attribution: walk a cost upward from each idea to its parents, with
probabilities equal to each parent's share of the value it receives (the time
reversal of the value walk). The relative error is 1e-15 over 200 random
graphs, 161 of them with cycles.

Priority aggregates as a **mediant**:
`π(X) = (kept + Σ flowᵢ) / (c_X + Σ flowᵢ·κᵢ)`. That lies between X's own
kept-value/cost and its children's priorities, so aggregation never invents
priority. This is also checked in `verify.py`.

### Cycles

- **Leaky cycles** (some member keeps something, or an edge leaves): the linear
  system is regular. `t` counts value each time it passes, so in a cycle
  `t` overcounts. The **reach** `t[X] / N[X,X]` counts it once, where
  `N = (I−Q)⁻¹` is the absorbing chain's fundamental matrix. Reach is the value
  that passes X at least once, from the identity
  `N[y,X] = P(reach X from y) · N[X,X]` (Kemeny & Snell). It is never larger than
  Σ i.
- The correction **cancels in priority**. A cycle has the same probability in
  the value walk and in its time-reversed cost walk, so value and cost are
  divided by the same `N[X,X]`. Priority is therefore `1/κ` with or without the
  correction, and the correction only matters for display.
- **Closed cycles** (nobody keeps anything, no way out) are the chain's
  absorbing classes. Whatever enters stays, split by the cycle's stationary
  distribution. The cycle acts as one leaf: `κ = Σ cost / mass entering`.
  `verify.py` confirms that this equals the limit of letting the cycle keep ε,
  on 100 random graphs with closed cycles.

The solve goes component by component in topological order, the Tarjan pass
`distributeCostsStable` already has. Acyclic parts are a plain sweep (`t`
forward, `κ` backward). Cycles get a small dense solve. There is no iteration,
epsilon or normalization.

## What the current model does

`verify.py` proves that "pour 100 %, pass on, normalize" has exactly the fixed
point

```
v = ½ · i/Σi + ½ · Pᵀ v        (personalized PageRank, damping ½)
```

Each step pours 1 and passes on 1, the sum is 2, and normalizing halves both.
So the normalization *is* a ½ discount per hop, whatever the intent. In
practice:

- Your example gives A = 1.33 and B = 0.67 instead of 1 and 1.
- An idea with intrinsic value keeps at least half of it as "realized here".
  `love` in ~/ideas keeps 4.7 % by its weights (self weight 1 against 16
  children) but holds 526 of 1068 (current) instead of 50 (proposed).
- Self weight as a self loop gets tangled with the ½. It only delays value
  passing on and is partly re-spent.
- The **ordering** is wrong in two examples. In the pass-through chain R → A → B,
  A ranks below R. In the diamond, A ranks below R.

### Examples (`examples.py`)

The models compared:

| model | aggregated value | aggregated cost |
|---|---|---|
| current | normalized value | attribution shares, cycles collapsed |
| flow+reach (proposed) | reach | κ · reach |
| flow+throughput | t (cycles counted per pass) | κ · t |
| flow+full-cost | reach | everything below, counted in full by every parent |

Results:

```
                                        current       flow+reach  flow+throughput   flow+full-cost
self weight splits value                 FAIL 6               ok               ok               ok
pass-through chain                       FAIL 9               ok               ok               ok
weights split value                      FAIL 9               ok               ok               ok
scale free                               FAIL 6               ok               ok               ok
diamond shares its base                 FAIL 11               ok               ok           FAIL 3
unequal parents share by value           FAIL 7               ok               ok           FAIL 4
intrinsic value below                    FAIL 7               ok               ok           FAIL 2
leaky cycle                             FAIL 12               ok           FAIL 4           FAIL 2
closed cycle                            FAIL 12               ok           FAIL 4               ok
root with self weight                    FAIL 9               ok               ok               ok
cost aggregates as a mediant             FAIL 3               ok               ok               ok
unconnected idea                             ok               ok               ok               ok
```

Only "self weight splits value" is yours. I derived the other expectations, so
check them, especially these two:

- **Diamond / leaky cycle:** a shared sub-idea's cost is split by the value
  each parent sends it. So in the leaky cycle B carries half of A's cost,
  because half of A's value arrives via B. The alternative is
  `flow+full-cost`, where every parent pays the full cost of everything below
  it. That answers "what does it take to finish X alone", but costs no longer
  add up.
- **Priority of a pure pass-through chain:** B (the leaf) is 1, A is ½, R is ⅓.
  The leaf ranks first because it is the cheapest piece of the same value.

## Real projects (`real_data.py`)

| project | ideas | cycles | rank correlation current ↔ proposed | largest share realized at one idea (current → proposed) |
|---|---|---|---|---|
| v7 | 774 | 1 (size 2) | 0.94 | 30 % → 31 % |
| ~/ideas | 1547 | 1 (size 6) | 0.96 | 40 % → 6 % |
| an-der-rax | 19 | 0 | 0.99 | 53 % → 12 % |

Priority rankings barely move: both models divide by similar attributed costs,
and leaves dominate the top. What moves are the **roots**. `love` drops from
rank 5 to rank 98, because the proposed model charges it the cost of its whole
tree (310 instead of 52). The current model's ½ also sizes nodes, so roots
dominate the picture through value they don't actually realize. With the
proposal, node size would be the aggregated value (reach): the root is the
largest and size shrinks down the tree by the weights.

Most real ideas have self weight 1 (the backend default), so an idea with one
sub-idea realizes half itself. That is the meaning of self weight 1, and it may
not be what people mean when they create a sub-idea.

## Literature

- Absorbing Markov chains and the fundamental matrix `N = (I−Q)⁻¹`:
  expected visits, absorption, `N[y,X] = h(y,X)·N[X,X]`. Kemeny & Snell,
  *Finite Markov Chains*. See
  [the fundamental matrix of a finite Markov chain](https://lips.cs.princeton.edu/the-fundamental-matrix-of-a-finite-markov-chain).
- Leontief input-output: total requirements `(I−A)⁻¹` and the price model
  `p' = v'(I−A)⁻¹`, the same quantity/price duality as `t` and `κ`. See the
  [Leontief inverse](https://www.openriskmanual.org/wiki/Leontief_Inverse_Matrix).
- Personalized PageRank is the current model, with damping ½.
- Saaty's ANP: priorities from the limit supermatrix `lim Wᵏ`. This is the
  stationary-distribution view, which the proposal uses only inside closed
  cycles.
- WSJF (Reinertsen): rank by cost of delay / size, the same value/cost ratio.
  The current duration discount can stay a factor on value.

## Decisions

1. Cost sharing as above: a shared sub-idea's cost is split by the value each
   parent sends it. If every parent paid in full, a common grandparent would
   count the shared part twice.
2. The value shown everywhere, node size included, is the aggregated value
   (`values`). Realized value is available as `realizedValues`.
3. The default self weight for new ideas stays at 1.

This settles *Self weight should keep its share* (bb8150a8). The per-hop
discount (6e1b0b0e) is now an explicit choice. It is currently 1 (no discount)
and could become `t = i + d·Qᵀt` if it's ever wanted.

Ideas no value reaches get their costs from the same calculation, with value
poured into their topmost ideas, so they share by connection weights alone.
`real_data.py` instead uses full-requirement cost for them.
