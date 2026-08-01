export function surfaceMovementShares(fromRadius: number, intoRadius: number) {
  const fromSurface = Math.max(0, fromRadius) ** 2
  const intoSurface = Math.max(0, intoRadius) ** 2
  const totalSurface = fromSurface + intoSurface
  if (totalSurface === 0) return { from: 0.5, into: 0.5 }

  // Each node moves in inverse proportion to its own surface/mass.
  return {
    from: intoSurface / totalSurface,
    into: fromSurface / totalSurface
  }
}

interface FlowForceLink {
  sourceId: string
  targetId: string
  flowValue: number
}

const SINGLE_CONNECTION_FORCE_WEIGHT = 0.75
const MIN_POSITIVE_FLOW_FORCE_WEIGHT = 0.25
const ABSENT_FLOW_FORCE_WEIGHT = 0.5

export function normalizedFlowForceWeights(links: FlowForceLink[]) {
  const incidentFlow = new Map<string, number>()

  for (const link of links) {
    const flow = Number.isFinite(link.flowValue) && link.flowValue > 0
      ? link.flowValue
      : 0
    if (flow === 0) continue
    incidentFlow.set(link.sourceId, (incidentFlow.get(link.sourceId) ?? 0) + flow)
    incidentFlow.set(link.targetId, (incidentFlow.get(link.targetId) ?? 0) + flow)
  }

  return links.map(link => {
    const flow = link.flowValue
    if (!Number.isFinite(flow) || flow <= 0) return ABSENT_FLOW_FORCE_WEIGHT

    const sourceTotal = incidentFlow.get(link.sourceId) ?? flow
    const targetTotal = incidentFlow.get(link.targetId) ?? flow

    // Normalize at both aims, then combine the two endpoint shares
    // symmetrically. This is flow / sqrt(sourceTotal * targetTotal), so both
    // ends use exactly the same pair strength: connection forces remain
    // equal-and-opposite and cannot introduce global drift. A thicker
    // connection still has more influence than a thinner sibling.
    const endpointNormalizedStrength = Math.min(
      1,
      flow / Math.sqrt(sourceTotal * targetTotal),
    )

    // Flow can span orders of magnitude. Square-root compression keeps small
    // structural links active while a sole connection retains the established
    // 0.75 settling strength.
    return MIN_POSITIVE_FLOW_FORCE_WEIGHT
      + (SINGLE_CONNECTION_FORCE_WEIGHT - MIN_POSITIVE_FLOW_FORCE_WEIGHT)
        * Math.sqrt(endpointNormalizedStrength)
  })
}
