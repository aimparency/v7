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
  it('keeps a sole connection at the established settling strength', () => {
    expect(normalizedFlowForceWeights([
      { sourceId: 'a', targetId: 'b', flowValue: 1 },
    ])).toEqual([0.75])
  })

  it('normalizes per aim while making a thicker sibling stronger', () => {
    const weights = normalizedFlowForceWeights([
      { sourceId: 'parent', targetId: 'small-child', flowValue: 1 },
      { sourceId: 'parent', targetId: 'large-child', flowValue: 4 },
    ])
    const small = weights[0]!
    const large = weights[1]!

    expect(large).toBeGreaterThan(small)
    expect(small).toBeGreaterThan(0.25)
    expect(large).toBeLessThanOrEqual(0.75)
  })

  it('is invariant to the graph absolute value scale', () => {
    const links = [
      { sourceId: 'a', targetId: 'b', flowValue: 1 },
      { sourceId: 'a', targetId: 'c', flowValue: 4 },
      { sourceId: 'c', targetId: 'd', flowValue: 16 },
    ]
    expect(normalizedFlowForceWeights(links.map(link => ({
      ...link,
      flowValue: link.flowValue * 0.01,
    })))).toEqual(normalizedFlowForceWeights(links))
  })

  it('uses a stable non-trivial fallback for absent flow', () => {
    expect(normalizedFlowForceWeights([
      { sourceId: 'a', targetId: 'b', flowValue: 0 },
      { sourceId: 'b', targetId: 'c', flowValue: Number.NaN },
    ])).toEqual([0.5, 0.5])
  })

  it('uses one symmetric strength for a pair regardless of its direction', () => {
    const weights = normalizedFlowForceWeights([
      { sourceId: 'a', targetId: 'b', flowValue: 3 },
      { sourceId: 'b', targetId: 'a', flowValue: 3 },
    ])
    const forward = weights[0]!
    const reverse = weights[1]!
    expect(forward).toBe(reverse)
  })
})
