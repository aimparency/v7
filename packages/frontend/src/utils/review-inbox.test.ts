import { describe, expect, it } from 'vitest'
import type { Phase } from 'shared'
import type { Idea } from '../stores/data'
import { firstAppearanceOrder, rankIdeasAwaitingHuman, sortChronologically } from './review-inbox'

const idea = (id: string, state: string, archived = false, children: string[] = []) =>
  ({ id, text: id, archived, status: { state, comment: '', date: 0 }, supportingConnections: children.map(ideaId => ({ ideaId })) }) as unknown as Idea
const phase = (id: string, commitments: string[], childPhaseIds: string[] = []) =>
  ({ id, name: id, parent: null, commitments, childPhaseIds }) as Phase

describe('rankIdeasAwaitingHuman', () => {
  it('lists review and human-dependent ideas by calculated priority, skipping the rest', () => {
    const ideas = Object.fromEntries([
      idea('low-review', 'review'),
      idea('high-blocked', 'human-dependent'),
      idea('open', 'open'),
      idea('archived-review', 'review', true),
      idea('unranked-review', 'review'),
      idea('question', 'unclear')
    ].map(entry => [entry.id, entry]))
    const priorities = new Map([['low-review', 0.2], ['high-blocked', 3], ['open', 9], ['archived-review', 5]])

    const ranked = rankIdeasAwaitingHuman(ideas, priorities)

    expect(ranked.map(entry => entry.idea.id)).toEqual(['high-blocked', 'low-review', 'unranked-review'])
    expect(ranked[0]!.priority).toBe(3)
  })

  it('can narrow to one state', () => {
    const ideas = { a: idea('a', 'review'), b: idea('b', 'human-dependent') }
    expect(rankIdeasAwaitingHuman(ideas, new Map(), ['review']).map(entry => entry.idea.id)).toEqual(['a'])
  })

  it('orders chronologically by first appearance: phase before subphase, commitments in order, sub-ideas after their parent', () => {
    const ideas = Object.fromEntries([
      idea('early', 'open', false, ['early-child']),
      idea('early-child', 'review'),
      idea('late', 'review'),
      idea('sub', 'review', false, ['early-child']),
      idea('floating', 'review')
    ].map(entry => [entry.id, entry]))
    const phases = { first: phase('first', ['early'], ['subphase']), subphase: phase('subphase', ['sub']), second: phase('second', ['late']) }

    const order = firstAppearanceOrder(phases, ['first', 'second'], ideas)
    const entries = rankIdeasAwaitingHuman(ideas, new Map([['floating', 9], ['late', 5]]))

    expect(sortChronologically(entries, order).map(entry => entry.idea.id)).toEqual(['early-child', 'sub', 'late', 'floating'])
  })
})
