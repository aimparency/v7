import { describe, expect, it } from 'vitest'
import type { Aim, Phase } from '../stores/data'
import {
  collectDescendantPhaseIds,
  formatAimPriority,
  rankAimsForPhaseTree
} from './phase-priority'

const phase = (id: string, childPhaseIds: string[] = []): Phase => ({
  id,
  name: id,
  parent: null,
  commitments: [],
  childPhaseIds
})

const aim = (
  id: string,
  text: string,
  state: string,
  committedIn: string[],
  archived = false,
  children: string[] = []
): Aim => ({
  id,
  text,
  archived,
  tags: [],
  supportingConnections: children.map(aimId => ({
    aimId,
    weight: 1,
    relativePosition: [0, 0] as [number, number]
  })),
  supportedAims: [],
  committedIn,
  status: { state, comment: '', date: 0 },
  intrinsicValue: 0,
  cost: 1,
  loopWeight: 0,
  duration: 1,
  costVariance: 0,
  valueVariance: 0,
  reflections: []
})

describe('phase priority ranking', () => {
  const phases = {
    root: phase('root', ['child']),
    child: phase('child', ['grandchild']),
    grandchild: phase('grandchild'),
    elsewhere: phase('elsewhere')
  }

  it('collects the selected phase and every descendant', () => {
    expect([...collectDescendantPhaseIds('root', phases)]).toEqual([
      'root',
      'child',
      'grandchild'
    ])
  })

  it('filters by state and phase tree, excludes archived aims, and ranks descending', () => {
    const aims = {
      low: aim('low', 'Low', 'human-dependent', ['root']),
      high: aim('high', 'High', 'human-dependent', ['grandchild']),
      open: aim('open', 'Open', 'open', ['child']),
      outside: aim('outside', 'Outside', 'human-dependent', ['elsewhere']),
      archived: aim('archived', 'Archived', 'human-dependent', ['root'], true)
    }

    expect(rankAimsForPhaseTree(
      'root',
      phases,
      aims,
      new Map([['low', 0.5], ['high', 3]]),
      'human-dependent'
    ).map(result => [result.aim.id, result.phaseId, result.priority, result.directlyCommitted])).toEqual([
      ['high', 'grandchild', 3, true],
      ['low', 'root', 0.5, true]
    ])
  })

  it('includes human-dependent descendants of a committed aim transitively', () => {
    const aims = {
      application: aim('application', 'Application', 'partially', ['root'], false, ['facts']),
      facts: aim('facts', 'Founder facts', 'human-dependent', [], false, ['submit']),
      submit: aim('submit', 'Submit', 'human-dependent', [])
    }

    expect(rankAimsForPhaseTree(
      'root',
      phases,
      aims,
      new Map([['facts', 4], ['submit', 9]]),
      'human-dependent'
    ).map(result => [result.aim.id, result.phaseId, result.directlyCommitted])).toEqual([
      ['submit', 'root', false],
      ['facts', 'root', false]
    ])
  })

  it('handles cycles in committed aim subtrees', () => {
    const aims = {
      application: aim('application', 'Application', 'partially', ['root'], false, ['facts']),
      facts: aim('facts', 'Founder facts', 'human-dependent', [], false, ['application'])
    }

    expect(rankAimsForPhaseTree(
      'root', phases, aims, new Map(), 'human-dependent'
    )).toHaveLength(1)
  })

  it('formats the profitability ratio compactly', () => {
    expect(formatAimPriority(0.5)).toBe('0.50×')
    expect(formatAimPriority(12.34)).toBe('12.3×')
    expect(formatAimPriority(123.4)).toBe('123×')
  })
})
