import { describe, expect, it } from 'vitest'
import type { Idea, Phase } from '../stores/data'
import {
  collectDescendantPhaseIds,
  formatIdeaPriority,
  rankIdeasForPhaseTree
} from './phase-priority'

const phase = (id: string, childPhaseIds: string[] = []): Phase => ({
  id,
  name: id,
  parent: null,
  commitments: [],
  childPhaseIds
})

const idea = (
  id: string,
  text: string,
  state: string,
  committedIn: string[],
  archived = false,
  children: string[] = []
): Idea => ({
  id,
  text,
  archived,
  tags: [],
  supportingConnections: children.map(ideaId => ({
    ideaId,
    weight: 1,
    relativePosition: [0, 0] as [number, number]
  })),
  supportedIdeas: [],
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

  it('filters by state and phase tree, excludes archived ideas, and ranks descending', () => {
    const ideas = {
      low: idea('low', 'Low', 'human-dependent', ['root']),
      high: idea('high', 'High', 'human-dependent', ['grandchild']),
      open: idea('open', 'Open', 'open', ['child']),
      outside: idea('outside', 'Outside', 'human-dependent', ['elsewhere']),
      archived: idea('archived', 'Archived', 'human-dependent', ['root'], true)
    }

    expect(rankIdeasForPhaseTree(
      'root',
      phases,
      ideas,
      new Map([['low', 0.5], ['high', 3]]),
      'human-dependent'
    ).map(result => [result.idea.id, result.phaseId, result.priority, result.directlyCommitted])).toEqual([
      ['high', 'grandchild', 3, true],
      ['low', 'root', 0.5, true]
    ])
  })

  it('includes human-dependent descendants of a committed idea transitively', () => {
    const ideas = {
      application: idea('application', 'Application', 'partially', ['root'], false, ['facts']),
      facts: idea('facts', 'Founder facts', 'human-dependent', [], false, ['submit']),
      submit: idea('submit', 'Submit', 'human-dependent', [])
    }

    expect(rankIdeasForPhaseTree(
      'root',
      phases,
      ideas,
      new Map([['facts', 4], ['submit', 9]]),
      'human-dependent'
    ).map(result => [result.idea.id, result.phaseId, result.directlyCommitted])).toEqual([
      ['submit', 'root', false],
      ['facts', 'root', false]
    ])
  })

  it('handles cycles in committed idea subtrees', () => {
    const ideas = {
      application: idea('application', 'Application', 'partially', ['root'], false, ['facts']),
      facts: idea('facts', 'Founder facts', 'human-dependent', [], false, ['application'])
    }

    expect(rankIdeasForPhaseTree(
      'root', phases, ideas, new Map(), 'human-dependent'
    )).toHaveLength(1)
  })

  it('formats the profitability ratio compactly', () => {
    expect(formatIdeaPriority(0.5)).toBe('0.50×')
    expect(formatIdeaPriority(12.34)).toBe('12.3×')
    expect(formatIdeaPriority(123.4)).toBe('123×')
  })
})
