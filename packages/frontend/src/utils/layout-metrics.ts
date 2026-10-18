// How readable a layout is, for the autolayout tests and the layout lab
// (scripts/layout-lab). Lengths and distances are in radius sums of the pair
// involved, so graphs of different idea sizes compare.

export interface MeasuredNode {
  id: string
  position: readonly [number, number]
  radius: number
}

export interface MeasuredLink {
  parentId: string
  childId: string
  strength?: number // 0.25–0.75 like LayoutLink; default 0.5
}

export interface MeasureContext {
  clearance?: number // crowded below this many radius sums (the solver's clearance)
  spacing?: number // connection length aimed for, for `lengthMisfit`
  start?: ReadonlyMap<string, readonly [number, number]> // positions before the layout, for `displacement`
  semanticPairs?: readonly { source: string; target: string; distance: number }[] // for `semanticNeighbourhood`
  neighbours?: number // most similar ideas compared with the nearest on screen
}

export interface LayoutMetrics {
  meanLength: number // per connection
  lengthMisfit: number // mean |length − spacing|; NaN without spacing
  crossings: number // pairs of connections without a shared idea that intersect
  weightedCrossings: number // the same, each counted as the product of the two strengths over 0.25
  shallowCrossings: number // crossings at less than 30°, hard to follow
  underIdea: number // a connection passing through an idea that is neither of its ends
  crowdedPairs: number // closer than the clearance
  overlaps: number // closer than 1 radius sum
  angleMedian: number // per idea with 2+ connections: narrowest gap / the gap of an even spread
  angleLow: number // its 10th percentile
  displacementMean: number // in idea diameters, net of the largest network's shift; NaN without start
  displacementMax: number
  semanticNeighbourhood: number // share of each idea's most similar ideas among its nearest on screen; NaN without pairs
  outwardViolations: number // share of children behind their parent, seen from the grandparents
}

type Point = readonly [number, number]

const SHALLOW = Math.sin(Math.PI / 6)

export function measureLayout(
  nodes: readonly MeasuredNode[],
  links: readonly MeasuredLink[],
  positions?: ReadonlyMap<string, Point>, // default: each node's own position
  { clearance = 3, spacing, start, semanticPairs, neighbours = 5 }: MeasureContext = {}
): LayoutMetrics {
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const positionOf = (id: string) => positions ? positions.get(id) : nodeById.get(id)?.position
  const placed = nodes.flatMap(node => {
    const position = positionOf(node.id)
    return position ? [{ id: node.id, position, radius: node.radius }] : []
  })
  const segments = links.flatMap(link => {
    const parent = positionOf(link.parentId)
    const child = positionOf(link.childId)
    const span = (nodeById.get(link.parentId)?.radius ?? 0) + (nodeById.get(link.childId)?.radius ?? 0)
    if (!parent || !child || span <= 0 || link.parentId === link.childId) return []
    const length = Math.hypot(child[0] - parent[0], child[1] - parent[1])
    return [{ link, parent, child, length, relative: length / span, strength: link.strength ?? 0.5 }]
  })

  let crossings = 0
  let weightedCrossings = 0
  let shallowCrossings = 0
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]!
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j]!
      if (a.link.parentId === b.link.parentId || a.link.parentId === b.link.childId
        || a.link.childId === b.link.parentId || a.link.childId === b.link.childId) continue
      if (!segmentsIntersect(a.parent, a.child, b.parent, b.child)) continue
      crossings++
      weightedCrossings += a.strength * b.strength / 0.25
      const sine = Math.abs(cross([0, 0], [a.child[0] - a.parent[0], a.child[1] - a.parent[1]], [b.child[0] - b.parent[0], b.child[1] - b.parent[1]])) / (a.length * b.length)
      if (sine < SHALLOW) shallowCrossings++
    }
  }

  let underIdea = 0
  for (const { link, parent, child } of segments) {
    const left = Math.min(parent[0], child[0])
    const right = Math.max(parent[0], child[0])
    const bottom = Math.min(parent[1], child[1])
    const top = Math.max(parent[1], child[1])
    for (const node of placed) {
      const [px, py] = node.position
      if (px + node.radius < left || px - node.radius > right || py + node.radius < bottom || py - node.radius > top) continue
      if (node.id === link.parentId || node.id === link.childId) continue
      if (distanceToSegment(node.position, parent, child) < node.radius) underIdea++
    }
  }

  let crowdedPairs = 0
  let overlaps = 0
  const swept = [...placed].sort((left, right) => left.position[0] - left.radius * clearance - (right.position[0] - right.radius * clearance))
  for (let i = 0; i < swept.length; i++) {
    const a = swept[i]!
    for (let j = i + 1; j < swept.length; j++) {
      const b = swept[j]!
      if (b.position[0] - b.radius * clearance > a.position[0] + a.radius * clearance) break
      const distance = Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1]) / (a.radius + b.radius)
      if (distance < clearance) crowdedPairs++
      if (distance < 1) overlaps++
    }
  }

  const angles = new Map<string, number[]>()
  const addAngle = (id: string, from: Point, to: Point) => {
    const list = angles.get(id) ?? []
    list.push(Math.atan2(to[1] - from[1], to[0] - from[0]))
    angles.set(id, list)
  }
  for (const { link, parent, child } of segments) {
    addAngle(link.parentId, parent, child)
    addAngle(link.childId, child, parent)
  }
  const resolutions = [...angles.values()].filter(list => list.length >= 2).map(list => {
    list.sort((left, right) => left - right)
    let narrowest = list[0]! + 2 * Math.PI - list[list.length - 1]!
    for (let i = 1; i < list.length; i++) narrowest = Math.min(narrowest, list[i]! - list[i - 1]!)
    return narrowest / (2 * Math.PI / list.length)
  }).sort((left, right) => left - right)

  return {
    meanLength: mean(segments.map(segment => segment.relative)),
    lengthMisfit: spacing === undefined ? NaN : mean(segments.map(segment => Math.abs(segment.relative - spacing))),
    crossings,
    weightedCrossings,
    shallowCrossings,
    underIdea,
    crowdedPairs,
    overlaps,
    angleMedian: quantile(resolutions, 0.5),
    angleLow: quantile(resolutions, 0.1),
    ...displacement(placed, links, start),
    semanticNeighbourhood: semanticPairs ? neighbourhood(placed, semanticPairs, neighbours) : NaN,
    outwardViolations: outward(segments, positionOf)
  }
}

function displacement(
  placed: readonly { id: string; position: Point; radius: number }[],
  links: readonly MeasuredLink[],
  start: ReadonlyMap<string, Point> | undefined
) {
  if (!start) return { displacementMean: NaN, displacementMax: NaN }
  const main = largestNetwork(placed.map(node => node.id), links)
  const moved = placed.flatMap(node => {
    const before = start.get(node.id)
    return before ? [{ node, dx: node.position[0] - before[0], dy: node.position[1] - before[1] }] : []
  })
  const inMain = moved.filter(({ node }) => main.has(node.id))
  const shiftX = mean(inMain.map(entry => entry.dx)) || 0
  const shiftY = mean(inMain.map(entry => entry.dy)) || 0
  const distances = moved.map(({ node, dx, dy }) => Math.hypot(dx - shiftX, dy - shiftY) / (2 * node.radius))
  return { displacementMean: mean(distances), displacementMax: Math.max(0, ...distances) }
}

function largestNetwork(ids: readonly string[], links: readonly MeasuredLink[]): Set<string> {
  const root = new Map(ids.map(id => [id, id]))
  const find = (id: string): string => {
    while (root.get(id) !== id) {
      const next = root.get(root.get(id)!)!
      root.set(id, next)
      id = next
    }
    return id
  }
  for (const { parentId, childId } of links) {
    if (root.has(parentId) && root.has(childId)) root.set(find(childId), find(parentId))
  }
  const members = new Map<string, string[]>()
  for (const id of ids) members.set(find(id), [...(members.get(find(id)) ?? []), id])
  let largest: string[] = []
  for (const list of members.values()) if (list.length > largest.length) largest = list
  return new Set(largest)
}

function neighbourhood(
  placed: readonly { id: string; position: Point }[],
  pairs: readonly { source: string; target: string; distance: number }[],
  k: number
) {
  const similar = new Map<string, { id: string; distance: number }[]>()
  const ids = new Set(placed.map(node => node.id))
  for (const { source, target, distance } of pairs) {
    if (!ids.has(source) || !ids.has(target) || source === target) continue
    similar.set(source, [...(similar.get(source) ?? []), { id: target, distance }])
  }
  const scores = placed.flatMap(node => {
    const list = similar.get(node.id)
    if (!list || list.length < k) return []
    const mostSimilar = new Set(list.sort((left, right) => left.distance - right.distance).slice(0, k).map(entry => entry.id))
    const nearest = placed
      .filter(other => other.id !== node.id)
      .map(other => ({ id: other.id, distance: Math.hypot(other.position[0] - node.position[0], other.position[1] - node.position[1]) }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, k)
    return [nearest.filter(entry => mostSimilar.has(entry.id)).length / k]
  })
  return mean(scores)
}

function outward(
  segments: readonly { link: MeasuredLink; parent: Point; child: Point }[],
  positionOf: (id: string) => Point | undefined
) {
  const parentsOf = new Map<string, string[]>()
  for (const { link } of segments) parentsOf.set(link.childId, [...(parentsOf.get(link.childId) ?? []), link.parentId])
  let judged = 0
  let behind = 0
  for (const { link, parent, child } of segments) {
    let awayX = 0
    let awayY = 0
    for (const grandparentId of parentsOf.get(link.parentId) ?? []) {
      const grandparent = positionOf(grandparentId)
      if (!grandparent) continue
      awayX += parent[0] - grandparent[0]
      awayY += parent[1] - grandparent[1]
    }
    if (awayX === 0 && awayY === 0) continue
    judged++
    if ((child[0] - parent[0]) * awayX + (child[1] - parent[1]) * awayY < 0) behind++
  }
  return judged === 0 ? 0 : behind / judged
}

const mean = (values: readonly number[]) => values.length === 0 ? NaN : values.reduce((sum, value) => sum + value, 0) / values.length

// Of ascending values.
const quantile = (sorted: readonly number[], share: number) => sorted.length === 0 ? NaN : sorted[Math.floor(share * (sorted.length - 1))]!

const cross = (o: Point, a: Point, b: Point) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point) {
  const d1 = cross(q1, q2, p1)
  const d2 = cross(q1, q2, p2)
  const d3 = cross(p1, p2, q1)
  const d4 = cross(p1, p2, q2)
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))
}

function distanceToSegment(point: Point, from: Point, to: Point) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const lengthSquared = dx * dx + dy * dy
  const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared))
  return Math.hypot(point[0] - from[0] - along * dx, point[1] - from[1] - along * dy)
}
