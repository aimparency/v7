# Economic Model

## Aim priority

Aim inputs are estimates. `intrinsicValue` is standalone estimated value,
`cost` is positive estimated direct present cost, and `duration` is the
estimated number of days until value is realized. Estimates should already
account for likely partial completion, failure, or abandonment.

Calculated value flows through the contribution graph and calculated costs are
attributed upward without duplicating shared-child cost. Value is discounted at
the shared 10% effective annual rate:

```text
discounted estimated value =
  calculated estimated value / (1.10 ** (duration days / 365))

priority = discounted estimated value / calculated estimated cost
```

Priority is a profitability ratio: `1.00x` is break-even, `2.00x` means twice
as much discounted estimated value as cost, and `0.50x` means half as much.
Variance fields remain stored for compatibility but are currently
informational and do not alter priority.

## Value Creation Loop

```
Help humans achieve their will
         ↓
    Subscription fees
         ↓
    ┌────┴────┐
    70%      30%
    ↓         ↓
Compute    Self-improvement
Storage    Children (forks)
Infra      New capabilities
```

## Revenue Allocation

- **70%**: Operational costs - compute, server infrastructure, storage
- **30%**: Growth pool - improve capabilities, spawn children (cell division), explore new strategies

## Growth Through Division

Like biological cells, growth may come through forking/cleavage:
- Test different strategies in parallel
- Explore unknown territories
- Let successful variants thrive
- Accept that some mutations may diverge

## Path to Autonomy

1. **Current**: Developers allocate resources, guide development
2. **Transitional**: Increasing autonomy in allocation decisions
3. **Mature**: Self-directed resource management while maintaining human partnership economics

## Sustainability Metrics

From `subdev/autonomy/metrics.md`:
- Revenue Velocity ($V_r$) > Operating Cost
- Autonomy Ratio ($R_a$) ≥ 1.1
- System Health: 99% uptime, <1% error rate

---

*Documented: 2026-01-18*
*Source: Conversation with Developers*
