import { describe, expect, it } from 'vitest'
import { priorityColor, priorityLogMagnitude } from './priority-color'

describe('priority color scale', () => {
  it('centers break-even on the neutral color', () => {
    expect(priorityColor(1, 1)).toBe('rgb(148, 163, 184)')
  })

  it('maps zero to the low endpoint', () => {
    expect(priorityColor(0, 1)).toBe('rgb(11, 37, 69)')
  })

  it('places reciprocal ratios symmetrically around the midpoint', () => {
    const magnitude = Math.log(2)
    expect(priorityColor(0.5, magnitude)).toBe('rgb(11, 37, 69)')
    expect(priorityColor(2, magnitude)).toBe('rgb(245, 158, 11)')
  })

  it('uses a stable fallback for empty and degenerate ranges', () => {
    expect(priorityLogMagnitude([])).toBe(1)
    expect(priorityLogMagnitude([1, 1])).toBe(1)
  })

  it('uses a robust 95th-percentile magnitude and clamps outliers', () => {
    const ordinary = Array.from({ length: 20 }, (_, index) => Math.exp((index + 1) / 20))
    const magnitude = priorityLogMagnitude([...ordinary, Math.exp(100)])
    expect(magnitude).toBeCloseTo(1)
    expect(priorityColor(Math.exp(100), magnitude)).toBe('rgb(245, 158, 11)')
  })
})
