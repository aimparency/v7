// Diff-minimal autolayout.
//
// The stored layout is one offset per connection: the child's position
// relative to its parent, in units of the two radii summed. The simulation turns
// those offsets into positions; overlaps and ideas with several disagreeing
// parents leave tension. This solver finds non-overlapping positions that keep
// as many stored offsets EXACTLY as possible, so persisting the result rewrites
// few connections (small git diffs) instead of nudging all of them.
//
// Method: iteratively reweighted least squares on the L1 norm of each
// connection's residual (a group lasso per connection), alternated with an
// overlap projection. The L1 weight 1/|residual| makes a satisfied connection
// stiff and a violated one cheap, so the needed movement concentrates on few
// connections; whole subtrees move rigidly with their root.

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

export interface LayoutChange {
  parentId: string
  childId: string
  relativePosition: [number, number]
}

export interface LayoutOptions {
  iterations?: number
  clearance?: number // minimum center distance, in radius sums (the simulation pushes softly up to 2)
  minimumChange?: number // residual, in radius sums, below which a connection keeps its stored offset
}

// Stored offsets are rounded so a re-save of an unchanged layout is diff-free.
const OFFSET_DECIMALS = 2
const OFFSET_SCALE = 10 ** OFFSET_DECIMALS
export const roundOffset = (offset: readonly [number, number]): [number, number] =>
  [Math.round(offset[0] * OFFSET_SCALE) / OFFSET_SCALE, Math.round(offset[1] * OFFSET_SCALE) / OFFSET_SCALE]

const ANCHOR_WEIGHT = 0.05 // keeps components where they are; the objective alone is translation invariant
const SMOOTHING = 0.01 // in radius sums: keeps 1/|residual| finite
const DAMPING = 0.5
const FINAL_SEPARATION_PASSES = 50

export function solveDiffMinimalLayout(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  { iterations = 300, clearance = 1.2, minimumChange = 0.05 }: LayoutOptions = {}
): { positions: Map<string, [number, number]>; changes: LayoutChange[] } {
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

  placeFromStoredOffsets(nodes, edges, x, y)
  const startX = x.slice()
  const startY = y.slice()

  const sumX = new Float64Array(count)
  const sumY = new Float64Array(count)
  const sumWeight = new Float64Array(count)
  const order = Array.from({ length: count }, (_, index) => index)

  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let index = 0; index < count; index++) {
      const drift = Math.hypot(x[index]! - startX[index]!, y[index]! - startY[index]!)
      const weight = ANCHOR_WEIGHT / Math.max(drift, SMOOTHING * radius[index]!)
      sumX[index] = weight * startX[index]!
      sumY[index] = weight * startY[index]!
      sumWeight[index] = weight
    }

    for (const edge of edges) {
      const { child, parent, dx, dy } = edge
      const residual = Math.hypot(x[child]! - x[parent]! - dx, y[child]! - y[parent]! - dy)
      const weight = 1 / Math.max(residual, SMOOTHING * edge.span)
      sumX[child] = sumX[child]! + weight * (x[parent]! + dx)
      sumY[child] = sumY[child]! + weight * (y[parent]! + dy)
      sumWeight[child] = sumWeight[child]! + weight
      sumX[parent] = sumX[parent]! + weight * (x[child]! - dx)
      sumY[parent] = sumY[parent]! + weight * (y[child]! - dy)
      sumWeight[parent] = sumWeight[parent]! + weight
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
    if (Math.hypot(offsetX - dx, offsetY - dy) <= minimumChange * span) return []
    return [{ parentId: link.parentId, childId: link.childId, relativePosition: roundOffset([offsetX / span, offsetY / span]) }]
  })
  return { positions, changes }
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
