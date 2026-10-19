import { describe, expect, it } from 'vitest'
import type { Phase } from '../stores/data'
import { phaseTreeDistances } from './phase-tree-distance'

const phase = (id: string, parent: string | null) => ({ id, parent, commitments: [], name: id }) as Phase

// root ─┬─ a ─┬─ a1 ── a1x
//       │     └─ a2
//       └─ b
const phases = Object.fromEntries([
  phase('a', null), phase('a1', 'a'), phase('a1x', 'a1'), phase('a2', 'a'), phase('b', null)
].map((p) => [p.id, p]))

describe('phaseTreeDistances', () => {
  it('counts steps up to the common ancestor and down again', () => {
    const distance = phaseTreeDistances('a1', phases)
    expect(['a1', 'a', 'a1x', 'a2', 'b'].map(distance)).toEqual([0, 1, 1, 2, 3])
  })

  it('measures from the root level', () => {
    const distance = phaseTreeDistances(null, phases)
    expect(['a', 'b', 'a1', 'a1x'].map(distance)).toEqual([1, 1, 2, 3])
  })

  it('cannot reach phases with a missing ancestor', () => {
    expect(phaseTreeDistances('a', { ...phases, lost: phase('lost', 'gone') })('lost')).toBe(Infinity)
  })
})
