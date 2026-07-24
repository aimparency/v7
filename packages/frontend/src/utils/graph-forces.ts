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

const BASE_FLOW_FORCE_WEIGHT = 0.75
const MIN_FLOW_FORCE_WEIGHT = 0.5
const MAX_FLOW_FORCE_WEIGHT = 1.5

export function normalizedFlowForceWeights(flowValues: number[]) {
  const positiveFlows = flowValues
    .filter(flow => Number.isFinite(flow) && flow > 0)
    .sort((a, b) => a - b)

  if (positiveFlows.length === 0) {
    return flowValues.map(() => MIN_FLOW_FORCE_WEIGHT)
  }

  const middle = Math.floor(positiveFlows.length / 2)
  const referenceFlow = positiveFlows.length % 2 === 0
    ? (positiveFlows[middle - 1]! + positiveFlows[middle]!) / 2
    : positiveFlows[middle]!

  return flowValues.map(flow => {
    if (!Number.isFinite(flow) || flow <= 0) return MIN_FLOW_FORCE_WEIGHT

    // Flow value is area-like and can span orders of magnitude. Comparing its
    // square root to the visible median keeps relative strength without making
    // the graph's absolute value scale determine overall convergence speed.
    const relativeStrength = Math.sqrt(flow / referenceFlow)
    return Math.max(
      MIN_FLOW_FORCE_WEIGHT,
      Math.min(MAX_FLOW_FORCE_WEIGHT, BASE_FLOW_FORCE_WEIGHT * relativeStrength),
    )
  })
}
