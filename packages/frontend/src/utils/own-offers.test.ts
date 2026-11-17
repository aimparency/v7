import { describe, expect, it } from 'vitest'
import { calculateIdeaValues, type Idea } from 'shared'
import { withOwnOffers } from './own-offers'

const REPO = '00000000-0000-4000-8000-000000000001'

function idea(id: string, extra: Partial<Idea> = {}): Idea {
  return { id, text: id, status: { state: 'open', comment: '', date: 0 }, supportingConnections: [], ...extra } as unknown as Idea
}

const ideas = () => [
  idea('goal', { intrinsicValue: 1, supportingConnections: [
    { ideaId: 'a', weight: 2, relativePosition: [0, 0] },
    { ideaId: 'b', weight: 1, relativePosition: [0, 0] },
  ] }),
  idea('a'),
  idea('b'),
]

describe('withOwnOffers', () => {
  it('gives the proposer\'s offered space 1 / (sibling weight + 1) of the idea\'s value', () => {
    const { values } = calculateIdeaValues(withOwnOffers(ideas(), [{ ideaId: 'goal', mine: true, space: { repoId: REPO } }]))
    expect(values.get(REPO)).toBeCloseTo(1 / 4)
  })

  it('leaves others\' offers and accepted spaces as they are', () => {
    const others = withOwnOffers(ideas(), [{ ideaId: 'goal', mine: false, space: { repoId: REPO } }])
    expect(others.every(entry => !entry.supportingRepos)).toBe(true)
    const accepted = ideas()
    accepted[0]!.supportingRepos = [{ repoId: REPO, weight: 3, relativePosition: [0, 0] }]
    expect(withOwnOffers(accepted, [{ ideaId: 'goal', mine: true, space: { repoId: REPO } }])[0]!.supportingRepos).toHaveLength(1)
  })
})
