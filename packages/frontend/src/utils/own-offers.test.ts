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
  it('gives the proposer\'s offered space the average weight of its siblings', () => {
    const { values } = calculateIdeaValues(withOwnOffers(ideas(), [{ ideaId: 'goal', mine: true, offeredSpace: { repoId: REPO } }]))
    // siblings 2 and 1: the offer weighs 1.5 of 4.5
    expect(values.get(REPO)).toBeCloseTo(1.5 / 4.5)
  })

  it('leaves others\' offers and accepted spaces as they are', () => {
    const others = withOwnOffers(ideas(), [{ ideaId: 'goal', mine: false, offeredSpace: { repoId: REPO } }])
    expect(others.every(entry => !entry.supportingRepos)).toBe(true)
    const accepted = ideas()
    accepted[0]!.supportingRepos = [{ repoId: REPO, weight: 3, relativePosition: [0, 0] }]
    expect(withOwnOffers(accepted, [{ ideaId: 'goal', mine: true, offeredSpace: { repoId: REPO } }])[0]!.supportingRepos).toHaveLength(1)
  })
})
