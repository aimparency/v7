// Autolayout that respects spatial memory.
//
// The stored layout is one offset per connection: the child's position
// relative to its parent, in units of the two radii summed. The solver looks for
// positions where the connections around each idea share the circle evenly
// at the target gap (strong ones more so), ideas keep their spacing and
// semantically close ideas sit near each other, while as many stored offsets
// as possible stay EXACTLY as they are. So a run rewrites few connections
// (small git diffs) and the original shape is kept; the preview then applies
// only the most relevant changes.
//
// Method: iteratively reweighted least squares. Each term proposes a target
// position with a weight; every iteration moves each idea toward the weighted
// mean. The memory term is an L1 norm per connection (weight 1/|residual|):
// a satisfied connection is stiff and a violated one cheap, so the needed
// movement concentrates on few connections, and whole subtrees move rigidly.
// The other terms are quadratic, so they only win where they are large.
//
// Scale: every target distance is measured in radius sums of the pair
// involved, and every weight is dimensionless, independent of idea size. A
// neighbourhood of small ideas is therefore laid out by exactly the same rules
// as one of big ideas, just smaller: zooming in shows the same quality. Where
// sizes mix, both ends of a pair are pulled equally hard.

import type { LayoutSettings } from 'shared'

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
  width: number // the drawn arrow's width: its share of the circle around both its ideas
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
  shift: number // how far the offset moves, in radius sums
  relevance: number // shift × √(span / mean span); changes are sorted by it, most relevant first
}

export interface LayoutOptions {
  iterations?: number
  clearance?: number // minimum center distance in radius sums; above the simulation's margin (2), so it comes to rest
  room?: number // connection length, in radius sums, that connections are pulled toward; at least `clearance`
  semanticPairs?: readonly SemanticPair[]
  minimumChange?: number // residual, in radius sums, below which a connection keeps its stored offset
  weights?: Partial<typeof DEFAULT_WEIGHTS>
  onProgress?: (progress: LayoutProgress) => void // the result so far, every `progressEvery` iterations
  progressEvery?: number
}

export interface LayoutProgress {
  changes: LayoutChange[]
}

// Stored offsets are rounded so a re-save of an unchanged layout is diff-free.
const OFFSET_DECIMALS = 2
const OFFSET_SCALE = 10 ** OFFSET_DECIMALS
export const roundOffset = (offset: readonly [number, number]): [number, number] =>
  [Math.round(offset[0] * OFFSET_SCALE) / OFFSET_SCALE, Math.round(offset[1] * OFFSET_SCALE) / OFFSET_SCALE]

// Weights are dimensionless: residuals are measured in radius sums.
const DEFAULT_ROOM = 4
const DEFAULT_WEIGHTS = {
  memory: 1, // keep stored offsets: the original shape
  length: 1.5, // pull each connection to its share of the circle around both its ideas, `room` long; was 3 times strengths of about 0.5
  // Per idea, connected or not, shared by its semantic pairs (its 12 most
  // similar ideas and those that count it among theirs); pulls toward
  // clearance · (1 + 2 · distance) radius sums. Higher brings ideas closer
  // to their similar ones but tangles connections.
  semantic: 0.1,
  separation: 4, // pushes ideas closer than `space` apart, as one pull among the others so the iterations converge; strongest when they touch, 1 / (1 + gap in radius sums)
  space: 5, // radius sums every idea keeps from every other, connected or not. At 3, ideas sat almost touching in large graphs
  // How hard a connection pulls, per idea: 1 − importance + importance · n · width / total width
  // of the idea's n connections. 0 all alike, 1 in proportion to the width; on average 1 either way.
  importance: 0.5
}
// What the Layout panel lets you tune. Settings
// saved before a setting existed lack it: `withLayoutDefaults` fills it in.
export const DEFAULT_LAYOUT_SETTINGS: Required<LayoutSettings> = { spacing: DEFAULT_ROOM, ...DEFAULT_WEIGHTS }
// Only current settings: older files also carry ones no longer used.
export const withLayoutDefaults = (settings: LayoutSettings | undefined): Required<LayoutSettings> =>
  Object.fromEntries(Object.entries(DEFAULT_LAYOUT_SETTINGS).map(([key, value]) => [key, settings?.[key as keyof LayoutSettings] ?? value])) as Required<LayoutSettings>
export const sameLayoutSettings = (left: LayoutSettings, right: LayoutSettings) =>
  (Object.keys(DEFAULT_LAYOUT_SETTINGS) as (keyof LayoutSettings)[]).every(key => withLayoutDefaults(left)[key] === withLayoutDefaults(right)[key])
export const layoutOptions = ({ spacing, ...weights }: LayoutSettings): LayoutOptions => ({ room: spacing, weights })
// Cosine distance: a neighbour 0.1 closer weighs e times more, so an idea
// lands near its closest neighbours rather than midway between all of them.
const SEMANTIC_SHARPNESS = 0.1
// Minimum center distance in radius sums; above the simulation's margin (2), so it comes to rest.
export const DEFAULT_CLEARANCE = 3

// Similarity, the same in the solver and in the live graph: each idea shares
// the `semantic` weight among its pairs, the closest ones getting most
// (softmax over distance): pulled toward the mean of all its neighbours, an
// idea would settle between them, next to none. A pair pulls only while it is
// farther apart than `length` radius sums. Connected ideas are left to their
// connection.
export interface SimilarityPair {
  a: number
  b: number
  length: number
  shareA: number // of a's semantic weight
  shareB: number
}
export function similarityPairs(
  indexOf: ReadonlyMap<string, number>,
  semanticPairs: readonly SemanticPair[],
  connected: (a: number, b: number) => boolean,
  clearance = DEFAULT_CLEARANCE
): SimilarityPair[] {
  const pairs = semanticPairs.flatMap(pair => {
    const a = indexOf.get(pair.source)
    const b = indexOf.get(pair.target)
    if (a === undefined || b === undefined || a === b || connected(a, b)) return []
    return [{ a, b, distance: pair.distance, similarity: Math.exp(-pair.distance / SEMANTIC_SHARPNESS) }]
  })
  const total = new Map<number, number>()
  for (const { a, b, similarity } of pairs) {
    total.set(a, (total.get(a) ?? 0) + similarity)
    total.set(b, (total.get(b) ?? 0) + similarity)
  }
  return pairs.map(({ a, b, distance, similarity }) => ({
    a, b, length: clearance * (1 + 2 * distance), shareA: similarity / total.get(a)!, shareB: similarity / total.get(b)!
  }))
}
const SMOOTHING = 0.01 // keeps 1/|residual| finite

export function solveLayout(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  options: LayoutOptions = {}
): { positions: Map<string, [number, number]>; changes: LayoutChange[] } {
  const { iterations = 300, onProgress, progressEvery = 10 } = options
  const solver = createLayoutSolver(nodes, links, options)
  for (let iteration = 0; iteration < iterations; iteration++) {
    solver.step()
    if (onProgress && (iteration + 1) % progressEvery === 0 && iteration + 1 < iterations) onProgress(solver.result())
  }
  return { positions: solver.positions(), ...solver.result() }
}

// The solver's state between iterations: the live Layout panel keeps one
// running and changes its settings on the way, so a small change continues
// from the current layout instead of solving again from the stored one.
export type LayoutSolver = ReturnType<typeof createLayoutSolver>

export function createLayoutSolver(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  { clearance = DEFAULT_CLEARANCE, room: initialRoom = DEFAULT_ROOM, semanticPairs = [], minimumChange = 0.05, weights: initialWeights = {} }: LayoutOptions = {}
) {
  let MEMORY = 0, LENGTH = 0, SEMANTIC = 0, SEPARATION = 0, SPACE = 0, IMPORTANCE = 0
  let room = initialRoom
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
    // Memory keeps the stored direction but no closer than the clearance:
    // a target inside it would fight the separation every iteration, so the
    // solver would cycle instead of coming to rest.
    const stored = Math.hypot(link.relativePosition[0], link.relativePosition[1])
    const keep = stored > 0 && stored < clearance ? clearance / stored : 1
    const dx = link.relativePosition[0] * span
    const dy = link.relativePosition[1] * span
    return [{ link, child, parent, span, dx, dy, keepX: dx * keep, keepY: dy * keep }]
  })
  // Every connection of an idea, to parents and children alike.
  const around = nodes.map(() => [] as { other: number; edge: number }[])
  edges.forEach(({ child, parent }, edge) => {
    around[parent]!.push({ other: child, edge })
    around[child]!.push({ other: parent, edge })
  })
  const width = Float64Array.from(edges, ({ link }) => link.width)
  const connected = new Set(edges.map(edge => edge.child * count + edge.parent))
  const pairs = similarityPairs(indexOf, semanticPairs, (a, b) => connected.has(a * count + b) || connected.has(b * count + a), clearance)
  // Translation is free for every term. After each iteration the centre of all ideas, weighted by area,
  // goes back where it started: groups pulled toward each other meet, the
  // heavier one moving less. Not when fixed ideas hold the layout in place.
  const mass = Float64Array.from(radius, value => value * value)
  const totalMass = mass.reduce((sum, value) => sum + value, 0)
  const pinned = nodes.every(node => node.movable)

  const setSettings = ({ room: newRoom = room, weights = {} }: Pick<LayoutOptions, 'room' | 'weights'>) => {
    room = newRoom
    ;({ memory: MEMORY, length: LENGTH, semantic: SEMANTIC, separation: SEPARATION, space: SPACE, importance: IMPORTANCE } =
      { ...DEFAULT_WEIGHTS, ...weights })
  }
  setSettings({ room: initialRoom, weights: initialWeights })

  // Every idea starts where the graph shows it; connections pull both their
  // ends, and their stored offsets are what `memory` keeps.
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

  const currentResult = (): LayoutProgress => {
    // Ranking between the scale-free shift, which favours tidying small ideas,
    // and the on-screen shift, which favours the big structure: the geometric
    // mean of both. Measured on a real graph, the top 20% by it removed more
    // crossings than by shift alone and left less crowding than by distance.
    const meanSpan = edges.reduce((sum, edge) => sum + edge.span, 0) / Math.max(edges.length, 1)
    const changes = edges.flatMap(({ link, child, parent, span, dx, dy }) => {
      if (!link.editable) return []
      const offsetX = x[child]! - x[parent]!
      const offsetY = y[child]! - y[parent]!
      const shift = Math.hypot(offsetX - dx, offsetY - dy) / span
      if (shift <= minimumChange) return []
      return [{ parentId: link.parentId, childId: link.childId, relativePosition: roundOffset([offsetX / span, offsetY / span]), shift, relevance: shift * Math.sqrt(span / meanSpan) }]
    }).sort((left, right) => right.relevance - left.relevance)
    return { changes }
  }

  const previousX = new Float64Array(count)
  const previousY = new Float64Array(count)
  // One iteration; stepSize is the share of the way each idea moves toward
  // its target. Returns the largest move of an idea, in radius sums: near 0
  // once it has converged.
  const slot: number[] = []
  const step = (stepSize = FREE_STEP): number => {
    previousX.set(x)
    previousY.set(y)
    sumX.fill(0)
    sumY.fill(0)
    sumWeight.fill(0)

    for (const { child, parent, span, keepX, keepY } of edges) {
      const vx = x[child]! - x[parent]!
      const vy = y[child]! - y[parent]!
      const memory = MEMORY / Math.max(Math.hypot(vx - keepX, vy - keepY) / span, SMOOTHING)
      pull(child, memory, x[parent]! + keepX, y[parent]! + keepY)
      pull(parent, memory, x[child]! - keepX, y[child]! - keepY)
    }

    // Around each idea, its connections share the full circle, each by its
    // width, in their current order, turned to fit their current directions
    // best (the width-weighted circular mean). Each pulls its other end to
    // the target gap in the middle of its share, and the idea the opposite
    // way: an idea settles amid its connections. When similarity or other
    // connections pull two past each other, the order follows in the next
    // iteration. A single connection keeps its direction. Every connection is
    // seen from both its ideas, each at half the weight. Crowded connections
    // make room through the minimum distance.
    for (let center = 0; center < count; center++) {
      const connections = around[center]!
      if (connections.length === 0) continue
      const angles = connections.map(({ other }) => Math.atan2(y[other]! - y[center]!, x[other]! - x[center]!))
      const sorted = connections.map((_, index) => index).sort((left, right) => angles[left]! - angles[right]!)
      const total = connections.reduce((sum, { edge }) => sum + width[edge]!, 0)
      let at = 0
      let turnX = 0
      let turnY = 0
      for (const index of sorted) {
        const share = total > 0 ? width[connections[index]!.edge]! / total : 1 / connections.length
        slot[index] = at + Math.PI * share
        at += 2 * Math.PI * share
        turnX += share * Math.cos(angles[index]! - slot[index]!)
        turnY += share * Math.sin(angles[index]! - slot[index]!)
      }
      const turn = Math.atan2(turnY, turnX)
      for (const [index, { other, edge }] of connections.entries()) {
        const share = total > 0 ? width[edge]! / total : 1 / connections.length
        const reach = room * edges[edge]!.span
        const targetX = Math.cos(slot[index]! + turn) * reach
        const targetY = Math.sin(slot[index]! + turn) * reach
        const weight = LENGTH * (1 - IMPORTANCE + IMPORTANCE * connections.length * share) / 2
        pull(other, weight, x[center]! + targetX, y[center]! + targetY)
        pull(center, weight, x[other]! - targetX, y[other]! - targetY)
      }
    }

    for (const { a, b, length, shareA, shareB } of pairs) {
      const vx = x[b]! - x[a]!
      const vy = y[b]! - y[a]!
      const distance = Math.hypot(vx, vy)
      const reach = length * (radius[a]! + radius[b]!)
      if (distance <= reach) continue
      const scale = reach / distance
      pull(b, SEMANTIC * shareB, x[a]! + vx * scale, y[a]! + vy * scale)
      pull(a, SEMANTIC * shareA, x[b]! - vx * scale, y[b]! - vy * scale)
    }

    // Ideas closer than the space: each pulled to where the pair would be
    // just far enough apart. Pushing them apart outright after each
    // iteration (as `separate` does at the end) fights the other terms, and
    // the iterations cycle instead of coming to rest.
    // Every pair alike, connected or not: a connection settles between the
    // target gap and the minimum distance.
    forEachOverlap(x, y, radius, SPACE, order, (a, b, deltaX, deltaY, distance, minimum) => {
      const span = radius[a]! + radius[b]!
      const push = (minimum - distance) / distance
      // Strongest when they touch, half as strong one radius sum apart.
      const weight = SEPARATION / (1 + Math.max(distance / span - 1, 0))
      pull(a, weight, x[a]! - deltaX * push, y[a]! - deltaY * push)
      pull(b, weight, x[b]! + deltaX * push, y[b]! + deltaY * push)
    })

    for (let index = 0; index < count; index++) {
      if (!nodes[index]!.movable) continue
      if (sumWeight[index]! === 0) continue // nothing pulls it
      x[index] = x[index]! + stepSize * (sumX[index]! / sumWeight[index]! - x[index]!)
      y[index] = y[index]! + stepSize * (sumY[index]! / sumWeight[index]! - y[index]!)
    }

    if (pinned) pinCentre()
    let largestMove = 0
    for (let index = 0; index < count; index++) {
      largestMove = Math.max(largestMove, Math.hypot(x[index]! - previousX[index]!, y[index]! - previousY[index]!) / (2 * radius[index]!))
    }
    return largestMove
  }

  const pinCentre = () => {
    let driftX = 0
    let driftY = 0
    for (let index = 0; index < count; index++) {
      driftX += mass[index]! * (x[index]! - startX[index]!)
      driftY += mass[index]! * (y[index]! - startY[index]!)
    }
    driftX /= totalMass
    driftY /= totalMass
    for (let index = 0; index < count; index++) {
      x[index] = x[index]! - driftX
      y[index] = y[index]! - driftY
    }
  }

  return {
    step,
    setSettings,
    result: currentResult,
    positions: () => new Map(nodes.map((node, index): [string, [number, number]] => [node.id, [x[index]!, y[index]!]]))
  }
}

const RELAX_BUDGET = 1200 // iterations at most, after the start and after every settings change
const RELAX_DURATION = 5000 // ms instead, with a clock (the live panel): the same calm-down whatever the graph's size; it then goes on with settled steps
const RELAX_CHUNK = 10 // iterations between results
// Each idea moves this share of the way to its target: the full step at
// first, shrinking linearly to the settled one by the end of the budget, so
// the solver calms down instead of oscillating until the budget cuts it off.
const FREE_STEP = 0.5
const SETTLED_STEP = 0.05
const CONVERGED = 0.2 // radius sums per full step: no idea's target was further in any iteration of a chunk

// Relaxes in chunks until converged or the budget is spent (iterations):
// what the lab runs. With `now` (the live panel), the budget is
// milliseconds of calming down, and chunks go on with settled steps after it;
// `done` then only says it has calmed down.
export function createRelaxation(solver: LayoutSolver, { budget = RELAX_BUDGET, now }: { budget?: number; now?: () => number } = {}) {
  let iterations = 0
  let sinceResume = 0
  let resumedAt = now?.() ?? 0
  const progress = () => now ? (now() - resumedAt) / RELAX_DURATION : sinceResume / budget
  return {
    // After a settings change: a fresh budget and full steps again, continuing from the current state.
    resume: () => {
      sinceResume = 0
      resumedAt = now?.() ?? 0
    },
    chunk: () => {
      let largestMove = 0
      for (let step = 0; step < RELAX_CHUNK && (now || progress() < 1); step++, sinceResume++, iterations++) {
        const stepSize = FREE_STEP + (SETTLED_STEP - FREE_STEP) * Math.min(progress(), 1)
        largestMove = Math.max(largestMove, solver.step(stepSize) / stepSize)
      }
      return { done: progress() >= 1 || largestMove < CONVERGED, largestMove }
    },
    iterations: () => iterations
  }
}

// Sweep along x; pushes each overlapping pair apart, the smaller idea moving more.
// Calls back for each pair of ideas closer than `reach` radius sums.
function forEachOverlap(
  x: Float64Array,
  y: Float64Array,
  radius: Float64Array,
  reach: number,
  order: number[],
  overlap: (a: number, b: number, deltaX: number, deltaY: number, distance: number, minimum: number) => void
) {
  order.sort((left, right) => (x[left]! - radius[left]! * reach) - (x[right]! - radius[right]! * reach))
  for (let i = 0; i < order.length; i++) {
    const a = order[i]!
    const reachA = x[a]! + radius[a]! * reach
    for (let j = i + 1; j < order.length; j++) {
      const b = order[j]!
      if (x[b]! - radius[b]! * reach > reachA) break
      const minimum = (radius[a]! + radius[b]!) * reach
      const deltaX = x[b]! - x[a]!
      const deltaY = y[b]! - y[a]!
      const distance = Math.hypot(deltaX, deltaY)
      if (distance >= minimum) continue
      // Deterministic direction for coincident ideas.
      if (distance === 0) overlap(a, b, 1, 0, 1, minimum)
      else overlap(a, b, deltaX, deltaY, distance, minimum)
    }
  }
}
