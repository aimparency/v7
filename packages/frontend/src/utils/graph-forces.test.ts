import { describe, expect, it } from 'vitest'
import { surfaceMovementShares } from './graph-forces'

describe('surfaceMovementShares', () => {
  it('moves equal-size aims equally', () => {
    expect(surfaceMovementShares(10, 10)).toEqual({ from: 0.5, into: 0.5 })
  })

  it('makes the smaller aim move more than the larger aim', () => {
    const shares = surfaceMovementShares(20, 10)
    expect(shares.from).toBeCloseTo(0.2)
    expect(shares.into).toBeCloseTo(0.8)
  })

  it('has a stable fallback for zero-size nodes', () => {
    expect(surfaceMovementShares(0, 0)).toEqual({ from: 0.5, into: 0.5 })
  })
})
