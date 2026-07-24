import { describe, expect, it } from 'vitest'
import { normalizedFlowForceWeights, surfaceMovementShares } from './graph-forces'

describe('surfaceMovementShares', () => {
  it('moves equal-size aims equally', () => {
    expect(surfaceMovementShares(10, 10)).toEqual({ from: 0.5, into: 0.5 })
  })

  it('makes the smaller aim move more than the larger aim', () => {
    const shares = surfaceMovementShares(20, 10)
    expect(shares.from).toBeCloseTo(0.2)
    expect(shares.into).toBeCloseTo(0.8)
  })

  it('conserves the surface-weighted center for unequal aims', () => {
    const fromRadius = 20
    const intoRadius = 10
    const movement = surfaceMovementShares(fromRadius, intoRadius)

    // The two movements point in opposite directions. Equal mass-weighted
    // magnitudes mean the internal pair interaction produces no net momentum.
    expect(fromRadius ** 2 * movement.from)
      .toBeCloseTo(intoRadius ** 2 * movement.into)
  })

  it('has a stable fallback for zero-size nodes', () => {
    expect(surfaceMovementShares(0, 0)).toEqual({ from: 0.5, into: 0.5 })
  })
})

describe('normalizedFlowForceWeights', () => {
  it('keeps a typical visible connection near the previous settling strength', () => {
    expect(normalizedFlowForceWeights([1])).toEqual([0.75])
  })

  it('makes larger flows stronger without starving smaller flows', () => {
    const [small, typical, large] = normalizedFlowForceWeights([0.25, 1, 4])
    expect(small).toBe(0.5)
    expect(typical).toBe(0.75)
    expect(large).toBe(1.5)
  })

  it('is invariant to the graph absolute value scale', () => {
    expect(normalizedFlowForceWeights([0.01, 0.04, 0.16]))
      .toEqual(normalizedFlowForceWeights([1, 4, 16]))
  })

  it('uses a stable non-trivial fallback for absent flow', () => {
    expect(normalizedFlowForceWeights([0, Number.NaN])).toEqual([0.5, 0.5])
  })
})
