// Autolayout that respects spatial memory.
//
// The stored layout is one offset per connection: the child's position
// relative to its parent, in units of the two radii summed. The solver looks for
// positions where connections are short, ideas keep the simulation's spacing,
// branches radiate outward and semantically close ideas sit near each other,
// while as many stored offsets as possible stay EXACTLY as they are. So a run
// rewrites few connections (small git diffs) and areas stay where they were.
//
// Method: iteratively reweighted least squares. Each term proposes a target
// position with a weight; every iteration moves each idea toward the weighted
// mean, then separates overlaps. The memory term is an L1 norm per connection
// (weight 1/|residual|): a satisfied connection is stiff and a violated one
// cheap, so the needed movement concentrates on few connections, and whole
// subtrees move rigidly with their root. The other terms are quadratic, so they
// only win where they are large: a connection is shortened once it is more
// than memory / length radius sums longer than `room`.

export interface LayoutNode {
  id: string
  position: readonly [number, number]
  radius: number
  movable: boolean
}

export interface LayoutLink {
  parentId: string
  childId: string
  relativePosition: readonly [number, number]
  editable: boolean
}

export interface SemanticPair {
  source: string
  target: string
  distance: number // cosine distance, 0 = same meaning
}

export interface LayoutChange {
  parentId: string
  childId: string
  relativePosition: [number, number]
  shift: number // how far the offset moves, in radius sums; changes are sorted by it, largest first
}

export interface LayoutOptions {
  iterations?: number
  clearance?: number // minimum center distance in radius sums; the simulation's own margin, so it comes to rest
  room?: number // connection length, in radius sums, that is never shortened
  semanticPairs?: readonly SemanticPair[]
  minimumChange?: number // residual, in radius sums, below which a connection keeps its stored offset
  weights?: Partial<typeof DEFAULT_WEIGHTS>
}

// Stored offsets are rounded so a re-save of an unchanged layout is diff-free.
const OFFSET_DECIMALS = 2
const OFFSET_SCALE = 10 ** OFFSET_DECIMALS
export const roundOffset = (offset: readonly [number, number]): [number, number] =>
  [Math.round(offset[0] * OFFSET_SCALE) / OFFSET_SCALE, Math.round(offset[1] * OFFSET_SCALE) / OFFSET_SCALE]

// Weights are dimensionless: residuals are measured in radius sums.
const DEFAULT_WEIGHTS = {
  memory: 3, // keep stored offsets
  length: 1, // shorten connections longer than `room`
  outward: 0.3, // a child lies beyond its parent, seen from the grandparents
  semantic: 0.002, // per semantic pair (there are thousands), pulls toward (clearance + 4 · distance) radius sums
  anchor: 0.05 // keeps every idea near where it was: the objective alone is translation invariant
}
const SMOOTHING = 0.01 // keeps 1/|residual| finite
const DAMPING = 0.5
const FINAL_SEPARATION_PASSES = 50

export function solveLayout(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  { iterations = 300, clearance = 2, room = 2.5, semanticPairs = [], minimumChange = 0.05, weights = {} }: LayoutOptions = {}
): { positions: Map<string, [number, number]>; changes: LayoutChange[] } {
  const { memory: MEMORY, length: LENGTH, outward: OUTWARD, semantic: SEMANTIC, anchor: ANCHOR } = { ...DEFAULT_WEIGHTS, ...weights }
  const count = nodes.length
  const indexOf = new Map(nodes.map((node, index) => [node.id, index]))
  const x = Float64Array.from(nodes, node => node.position[0])
  const y = Float64Array.from(nodes, node => node.position[1])
  const radius = Float64Array.from(nodes, node => node.radius)

  const edges = links.flatMap(link => {
    const child = indexOf.get(link.childId)
    const parent = indexOf.get(link.parentId)
    if (child === undefined || parent === undefined || child === parent) return []
    const span = radius[child]! + radius[parent]!
    return [{ link, child, parent, span, dx: link.relativePosition[0] * span, dy: link.relativePosition[1] * span }]
  })
  const parentsOf = nodes.map(() => [] as number[])
  for (const edge of edges) parentsOf[edge.child]!.push(edge.parent)
  const connected = new Set(edges.map(edge => edge.child * count + edge.parent))
  const pairs = semanticPairs.flatMap(pair => {
    const a = indexOf.get(pair.source)
    const b = indexOf.get(pair.target)
    if (a === undefined || b === undefined || a === b || connected.has(a * count + b) || connected.has(b * count + a)) return []
    return [{ a, b, span: radius[a]! + radius[b]!, length: clearance + 4 * pair.distance }]
  })

  placeFromStoredOffsets(nodes, edges, x, y)
  const startX = x.slice()
  const startY = y.slice()

  const sumX = new Float64Array(count)
  const sumY = new Float64Array(count)
  const sumWeight = new Float64Array(count)
  const pull = (index: number, weight: number, targetX: number, targetY: number) => {
    sumX[index] = sumX[index]! + weight * targetX
    sumY[index] = sumY[index]! + weight * targetY
    sumWeight[index] = sumWeight[index]! + weight
  }
  const order = Array.from({ length: count }, (_, index) => index)

  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let index = 0; index < count; index++) {
      const drift = Math.hypot(x[index]! - startX[index]!, y[index]! - startY[index]!) / radius[index]!
      sumX[index] = 0
      sumY[index] = 0
      sumWeight[index] = 0
      pull(index, ANCHOR / Math.max(drift, SMOOTHING), startX[index]!, startY[index]!)
    }

    for (const { child, parent, span, dx, dy } of edges) {
      const vx = x[child]! - x[parent]!
      const vy = y[child]! - y[parent]!

      const memory = MEMORY / Math.max(Math.hypot(vx - dx, vy - dy) / span, SMOOTHING)
      pull(child, memory, x[parent]! + dx, y[parent]! + dy)
      pull(parent, memory, x[child]! - dx, y[child]! - dy)

      const length = Math.hypot(vx, vy)
      if (length > room * span) {
        const scale = room * span / length
        pull(child, LENGTH, x[parent]! + vx * scale, y[parent]! + vy * scale)
        pull(parent, LENGTH, x[child]! - vx * scale, y[child]! - vy * scale)
      }

      const grandparents = parentsOf[parent]!
      if (grandparents.length > 0 && length > 0) {
        let fromX = 0
        let fromY = 0
        for (const grandparent of grandparents) {
          fromX += x[parent]! - x[grandparent]!
          fromY += y[parent]! - y[grandparent]!
        }
        const fromLength = Math.hypot(fromX, fromY)
        if (fromLength > 0) pull(child, OUTWARD, x[parent]! + fromX / fromLength * length, y[parent]! + fromY / fromLength * length)
      }
    }

    for (const { a, b, span, length } of pairs) {
      const vx = x[b]! - x[a]!
      const vy = y[b]! - y[a]!
      const distance = Math.hypot(vx, vy)
      if (distance <= length * span) continue
      const scale = length * span / distance
      pull(b, SEMANTIC, x[a]! + vx * scale, y[a]! + vy * scale)
      pull(a, SEMANTIC, x[b]! - vx * scale, y[b]! - vy * scale)
    }

    for (let index = 0; index < count; index++) {
      if (!nodes[index]!.movable) continue
      x[index] = x[index]! + DAMPING * (sumX[index]! / sumWeight[index]! - x[index]!)
      y[index] = y[index]! + DAMPING * (sumY[index]! / sumWeight[index]! - y[index]!)
    }

    separateOverlaps(nodes, x, y, radius, clearance, order)
  }
  // Big ideas can keep pushing each other's neighbourhoods; finish without overlaps.
  for (let pass = 0; pass < FINAL_SEPARATION_PASSES; pass++) separateOverlaps(nodes, x, y, radius, clearance, order)

  const positions = new Map(nodes.map((node, index): [string, [number, number]] => [node.id, [x[index]!, y[index]!]]))
  const changes = edges.flatMap(({ link, child, parent, span, dx, dy }) => {
    if (!link.editable) return []
    const offsetX = x[child]! - x[parent]!
    const offsetY = y[child]! - y[parent]!
    const shift = Math.hypot(offsetX - dx, offsetY - dy) / span
    if (shift <= minimumChange) return []
    return [{ parentId: link.parentId, childId: link.childId, relativePosition: roundOffset([offsetX / span, offsetY / span]), shift }]
  }).sort((left, right) => right.shift - left.shift)
  return { positions, changes }
}

/** Where the stored offsets alone put each idea; what the simulation settles toward. */
export function positionsFromStoredOffsets(nodes: readonly LayoutNode[], links: readonly LayoutLink[]): Map<string, [number, number]> {
  const indexOf = new Map(nodes.map((node, index) => [node.id, index]))
  const x = Float64Array.from(nodes, node => node.position[0])
  const y = Float64Array.from(nodes, node => node.position[1])
  const edges = links.flatMap(link => {
    const child = indexOf.get(link.childId)
    const parent = indexOf.get(link.parentId)
    if (child === undefined || parent === undefined || child === parent) return []
    const span = nodes[child]!.radius + nodes[parent]!.radius
    return [{ child, parent, dx: link.relativePosition[0] * span, dy: link.relativePosition[1] * span }]
  })
  placeFromStoredOffsets(nodes, edges, x, y)
  return new Map(nodes.map((node, index): [string, [number, number]] => [node.id, [x[index]!, y[index]!]]))
}

// The diff is measured against the stored offsets, not against what the
// simulation currently shows, so start where the stored offsets put each idea:
// roots (and fixed ideas) stay put, descendants follow their first placed parent.
function placeFromStoredOffsets(
  nodes: readonly LayoutNode[],
  edges: readonly { child: number; parent: number; dx: number; dy: number }[],
  x: Float64Array,
  y: Float64Array
) {
  const childEdges = nodes.map(() => [] as (typeof edges)[number][])
  const hasParent = new Uint8Array(nodes.length)
  for (const edge of edges) {
    childEdges[edge.parent]!.push(edge)
    hasParent[edge.child] = 1
  }
  const placed = new Uint8Array(nodes.length)
  const queue: number[] = []
  const seed = (index: number) => {
    if (placed[index]) return
    placed[index] = 1
    queue.push(index)
  }
  const drain = () => {
    while (queue.length > 0) {
      const parent = queue.shift()!
      for (const edge of childEdges[parent]!) {
        if (placed[edge.child]) continue
        x[edge.child] = x[parent]! + edge.dx
        y[edge.child] = y[parent]! + edge.dy
        seed(edge.child)
      }
    }
  }
  nodes.forEach((node, index) => { if (!hasParent[index] || !node.movable) seed(index) })
  drain()
  // Ideas only reachable through a cycle keep their current position as a seed.
  nodes.forEach((_, index) => { seed(index); drain() })
}

// Sweep along x; pushes each overlapping pair apart, the smaller idea moving more.
function separateOverlaps(
  nodes: readonly LayoutNode[],
  x: Float64Array,
  y: Float64Array,
  radius: Float64Array,
  clearance: number,
  order: number[]
) {
  order.sort((left, right) => (x[left]! - radius[left]! * clearance) - (x[right]! - radius[right]! * clearance))
  for (let i = 0; i < order.length; i++) {
    const a = order[i]!
    const reachA = x[a]! + radius[a]! * clearance
    for (let j = i + 1; j < order.length; j++) {
      const b = order[j]!
      if (x[b]! - radius[b]! * clearance > reachA) break
      const minimum = (radius[a]! + radius[b]!) * clearance
      let deltaX = x[b]! - x[a]!
      let deltaY = y[b]! - y[a]!
      let distance = Math.hypot(deltaX, deltaY)
      if (distance >= minimum) continue
      if (distance === 0) {
        // Deterministic direction for coincident ideas.
        deltaX = 1
        deltaY = 0
        distance = 1
      }
      const areaA = nodes[a]!.movable ? radius[a]! ** 2 : Infinity
      const areaB = nodes[b]!.movable ? radius[b]! ** 2 : Infinity
      if (areaA === Infinity && areaB === Infinity) continue
      const shareA = areaA === Infinity ? 0 : areaB === Infinity ? 1 : areaB / (areaA + areaB)
      const push = (minimum - distance) / distance
      x[a] = x[a]! - deltaX * push * shareA
      y[a] = y[a]! - deltaY * push * shareA
      x[b] = x[b]! + deltaX * push * (1 - shareA)
      y[b] = y[b]! + deltaY * push * (1 - shareA)
    }
  }
}
