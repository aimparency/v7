import { describe, expect, it } from 'vitest'
import { proposeRelaxedConnections, type RelaxableLink } from '../auto-relax'

function link(childId: string, childPosition: [number, number], relativePosition: [number, number] = [0, 0]): RelaxableLink {
  return {
    parentId: 'parent', childId, parentPosition: [0, 0], childPosition,
    parentRadius: 1, childRadius: 1, relativePosition
  }
}

describe('proposeRelaxedConnections', () => {
  it('evenly spaces siblings and preserves displayed distance', () => {
    const result = proposeRelaxedConnections([
      link('a', [2, 0]), link('b', [0, 4]), link('c', [-2, 0])
    ])
    expect(result).toHaveLength(3)
    const angles = result.map(item => Math.atan2(item.relativePosition[1], item.relativePosition[0])).sort((a, b) => a - b)
    const gaps = [angles[1]! - angles[0]!, angles[2]! - angles[1]!, angles[0]! + Math.PI * 2 - angles[2]!]
    gaps.forEach(gap => expect(gap).toBeCloseTo(Math.PI * 2 / 3))
    expect(Math.hypot(...result.find(item => item.childId === 'b')!.relativePosition)).toBeCloseTo(2)
  })

  it('omits changes at or below the three-percent threshold', () => {
    const result = proposeRelaxedConnections([
      link('a', [2, 0], [1.01, 0]), link('b', [-2, 0], [-1.01, 0])
    ])
    expect(result).toEqual([])
  })

  it('does not alter single-child parents', () => {
    expect(proposeRelaxedConnections([link('a', [2, 0])])).toEqual([])
  })
})
