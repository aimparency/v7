import { describe, expect, it } from 'vitest'
import type { Idea } from '../stores/data'
import { rankIdeasAwaitingHuman } from './review-inbox'

const idea = (id: string, state: string, archived = false) =>
  ({ id, text: id, archived, status: { state, comment: '', date: 0 } }) as unknown as Idea

describe('rankIdeasAwaitingHuman', () => {
  it('lists review and human-dependent ideas by calculated priority, skipping the rest', () => {
    const ideas = Object.fromEntries([
      idea('low-review', 'review'),
      idea('high-blocked', 'human-dependent'),
      idea('open', 'open'),
      idea('archived-review', 'review', true),
      idea('unranked-review', 'review')
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
})
