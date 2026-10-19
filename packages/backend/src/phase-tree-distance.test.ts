import { describe, expect, it } from 'vitest'
import type { Phase } from 'shared'
import { phaseTreeDistances } from './phase-tree-distance.js'

const phase = (id: string, parent: string | null, childPhaseIds: string[] = []) =>
  ({ id, parent, childPhaseIds, commitments: [], name: id }) as Phase
const tree = (...list: Phase[]) => Object.fromEntries(list.map((p) => [p.id, p]))

// root ─┬─ a ─┬─ a1 ── a1x
//       │     └─ a2
//       └─ b
const phases = tree(
  phase('a', null), phase('a1', 'a'), phase('a1x', 'a1'), phase('a2', 'a'), phase('b', null)
)

describe('phaseTreeDistances', () => {
  it('counts steps up to the common ancestor and down again', () => {
    const distance = phaseTreeDistances('a1', phases)
    expect(['a1', 'a', 'a1x', 'a2', 'b'].map(distance)).toEqual([0, 1, 1, 2, 3])
  })

  it('of equally distant phases, ranks those beside the origin first', () => {
    // r ── [a1, a2, b] and r ── [b, a1, a2]: from b, a2 resp. a1 is the nearer sibling.
    const siblingsInOrder = (order: string[]) => tree(phase('r', null, order), ...order.map((id) => phase(id, 'r')))
    const rank = (order: string[]) => {
      const distance = phaseTreeDistances('b', siblingsInOrder(order), ['r'])
      return ['a1', 'a2'].sort((x, y) => distance(x) - distance(y))
    }
    expect(rank(['a1', 'a2', 'b'])).toEqual(['a2', 'a1'])
    expect(rank(['b', 'a1', 'a2'])).toEqual(['a1', 'a2'])
  })

  it('never lets sibling order outweigh a step', () => {
    const order = ['b', 'x', 'y', 'a']
    const distance = phaseTreeDistances('b', tree(phase('r', null, order), ...order.map((id) => phase(id, 'r')), phase('b1', 'b')), ['r'])
    expect(distance('a')).toBeLessThan(3)
    expect(distance('a')).toBeGreaterThan(distance('x'))
    expect(distance('r')).toBe(1)
  })

  it('cannot reach phases with a missing ancestor', () => {
    expect(phaseTreeDistances('a', { ...phases, lost: phase('lost', 'gone') })('lost')).toBe(Infinity)
  })
})
