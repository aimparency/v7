import { describe, expect, it } from 'vitest'
import { averageSupportWeight } from './connection-weight'

describe('averageSupportWeight', () => {
  it('is 1 for an idea nothing supports yet', () => {
    expect(averageSupportWeight(undefined)).toBe(1)
    expect(averageSupportWeight({ supportingConnections: [] })).toBe(1)
  })
  it('is the average of the weights there are', () => {
    expect(averageSupportWeight({ supportingConnections: [{ weight: 2 }, { weight: 4 }, {}] })).toBeCloseTo(7 / 3)
  })
  it('falls back to 1 when the others weigh nothing', () => {
    expect(averageSupportWeight({ supportingConnections: [{ weight: 0 }] })).toBe(1)
  })
})
