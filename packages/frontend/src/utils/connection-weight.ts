// The weight a connection drawn in the graph starts with: the average of the
// weights of the ideas that already support the idea, so a new one neither
// dominates nor vanishes next to them (1 for the first).
export function averageSupportWeight(idea: { supportingConnections?: { weight?: number }[] } | undefined): number {
  const weights = (idea?.supportingConnections ?? []).map(connection => connection.weight ?? 1).filter(weight => Number.isFinite(weight))
  if (weights.length === 0) return 1
  const average = weights.reduce((sum, weight) => sum + weight, 0) / weights.length
  return average > 0 ? average : 1
}
