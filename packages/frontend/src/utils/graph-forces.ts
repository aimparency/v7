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

// Each connection's flow, normalized at both incident ideas (0–1):
// flow / sqrt(sourceTotal · targetTotal), so both ends use the same pair
// strength and connection forces stay equal and opposite. NaN without flow.
export function endpointFlowShares(links: FlowForceLink[]) {
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
    if (!Number.isFinite(flow) || flow <= 0) return NaN
    const sourceTotal = incidentFlow.get(link.sourceId) ?? flow
    const targetTotal = incidentFlow.get(link.targetId) ?? flow
    return Math.min(1, flow / Math.sqrt(sourceTotal * targetTotal))
  })
}

export function normalizedFlowForceWeights(links: FlowForceLink[]) {
  // Flow can span orders of magnitude. Square-root compression keeps small
  // structural links active while a sole connection retains the established
  // 0.75 settling strength. A thicker connection still has more influence
  // than a thinner sibling.
  return endpointFlowShares(links).map(share => Number.isNaN(share)
    ? ABSENT_FLOW_FORCE_WEIGHT
    : MIN_POSITIVE_FLOW_FORCE_WEIGHT + (SINGLE_CONNECTION_FORCE_WEIGHT - MIN_POSITIVE_FLOW_FORCE_WEIGHT) * Math.sqrt(share))
}

const MIN_NODE_RADIUS = 40

// Area ∝ value; the radius floor keeps value-less ideas clickable without
// inflating the others.
export function nodeRadius(value: number, averageValue: number) {
  return Math.max(Math.sqrt(value / (averageValue || 1)) * 150, MIN_NODE_RADIUS)
}

// Mean position of the given ideas that have a stored position ((0, 0) for none).
export function positionCentroid(positions: ReadonlyMap<string, { x: number, y: number }>, ideaIds: readonly string[]) {
  let x = 0
  let y = 0
  let count = 0
  for (const id of ideaIds) {
    const pos = positions.get(id)
    if (!pos) continue
    x += pos.x
    y += pos.y
    count++
  }
  return count ? { x: x / count, y: y / count } : { x: 0, y: 0 }
}
