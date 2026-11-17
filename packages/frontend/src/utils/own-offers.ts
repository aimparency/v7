import type { Idea } from 'shared'

type Offer = { ideaId: string; mine: boolean; space?: { repoId: string } | null; relativePosition?: [number, number] | null }

// The proposer sees their offered spaces as if accepted: each joins its idea
// as a supporter of weight 1, beside the weights already there, so it gets
// 1 / (sibling weight + 1) of the idea's value. Others see no change.
export function withOwnOffers<T extends Idea>(ideas: T[], offers: Offer[]): T[] {
  const own = offers.filter(offer => offer.mine && offer.space)
  if (own.length === 0) return ideas
  return ideas.map(idea => {
    const offered = own
      .filter(offer => offer.ideaId === idea.id && !idea.supportingRepos?.some(edge => edge.repoId === offer.space!.repoId))
      .map(offer => ({ repoId: offer.space!.repoId, weight: 1, relativePosition: offer.relativePosition ?? [0, 1.5] as [number, number] }))
    return offered.length ? { ...idea, supportingRepos: [...(idea.supportingRepos ?? []), ...offered] } : idea
  })
}
