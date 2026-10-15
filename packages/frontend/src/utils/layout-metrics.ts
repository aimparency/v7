// How readable a layout is: connection length, crossings, crowding.
// Lengths and distances are in radius sums of the pair involved.

export interface MeasuredNode {
  id: string
  position: readonly [number, number]
  radius: number
}

export interface MeasuredLink {
  parentId: string
  childId: string
}

export interface LayoutMetrics {
  meanLength: number // per connection
  longConnections: number // longer than 4 radius sums
  crossings: number // pairs of connections without a shared idea that intersect
  crowdedPairs: number // closer than `margin` radius sums (the simulation keeps pushing these)
  overlaps: number // closer than 1 radius sum
}

export function measureLayout(
  nodes: readonly MeasuredNode[],
  links: readonly MeasuredLink[],
  positions?: ReadonlyMap<string, readonly [number, number]>, // default: each node's own position
  margin = 2
): LayoutMetrics {
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const positionOf = (id: string) => positions ? positions.get(id) : nodeById.get(id)?.position
  const segments = links.flatMap(link => {
    const parent = positionOf(link.parentId)
    const child = positionOf(link.childId)
    const span = (nodeById.get(link.parentId)?.radius ?? 0) + (nodeById.get(link.childId)?.radius ?? 0)
    if (!parent || !child || span <= 0) return []
    return [{ link, parent, child, length: Math.hypot(child[0] - parent[0], child[1] - parent[1]) / span }]
  })

  let crossings = 0
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]!
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j]!
      if (a.link.parentId === b.link.parentId || a.link.parentId === b.link.childId
        || a.link.childId === b.link.parentId || a.link.childId === b.link.childId) continue
      if (segmentsIntersect(a.parent, a.child, b.parent, b.child)) crossings++
    }
  }

  let crowdedPairs = 0
  let overlaps = 0
  const placed = nodes.flatMap(node => {
    const position = positionOf(node.id)
    return position ? [{ position, radius: node.radius }] : []
  }).sort((left, right) => left.position[0] - left.radius * margin - (right.position[0] - right.radius * margin))
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i]!
    for (let j = i + 1; j < placed.length; j++) {
      const b = placed[j]!
      if (b.position[0] - b.radius * margin > a.position[0] + a.radius * margin) break
      const distance = Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1]) / (a.radius + b.radius)
      if (distance < margin) crowdedPairs++
      if (distance < 1) overlaps++
    }
  }

  return {
    meanLength: segments.reduce((sum, segment) => sum + segment.length, 0) / Math.max(segments.length, 1),
    longConnections: segments.filter(segment => segment.length > 4).length,
    crossings,
    crowdedPairs,
    overlaps
  }
}

const cross = (o: readonly [number, number], a: readonly [number, number], b: readonly [number, number]) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

function segmentsIntersect(
  p1: readonly [number, number], p2: readonly [number, number],
  q1: readonly [number, number], q2: readonly [number, number]
) {
  const d1 = cross(q1, q2, p1)
  const d2 = cross(q1, q2, p2)
  const d3 = cross(p1, p2, q1)
  const d4 = cross(p1, p2, q2)
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))
}
