import type { Idea } from 'shared'

type Offer = { ideaId: string; mine: boolean; space?: { repoId: string } | null; relativePosition?: [number, number] | null }

// The proposer sees their offered spaces as if accepted: each joins its idea
// with the average weight of the idea's other supporters (1 if it has none).
// Others see no change.
export function withOwnOffers<T extends Idea>(ideas: T[], offers: Offer[]): T[] {
  const own = offers.filter(offer => offer.mine && offer.space)
  if (own.length === 0) return ideas
  return ideas.map(idea => {
    const offers = own.filter(offer => offer.ideaId === idea.id && !idea.supportingRepos?.some(edge => edge.repoId === offer.space!.repoId))
    if (offers.length === 0) return idea
    const weights = [...(idea.supportingConnections ?? []), ...(idea.supportingRepos ?? [])].map(edge => edge.weight || 1)
    const weight = weights.length ? weights.reduce((sum, value) => sum + value, 0) / weights.length : 1
    const offered = offers.map(offer => ({ repoId: offer.space!.repoId, weight, relativePosition: offer.relativePosition ?? [0, 1.5] as [number, number] }))
    return { ...idea, supportingRepos: [...(idea.supportingRepos ?? []), ...offered] }
  })
}
