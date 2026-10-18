// Autolayout that respects spatial memory.
//
// The stored layout is one offset per connection: the child's position
// relative to its parent, in units of the two radii summed. The solver looks for
// positions where connections are short (strong ones more so), ideas keep their
// spacing, the connections around each idea spread over the circle, branches
// keep pointing away from their parents and semantically close ideas sit near
// each other, while as many stored offsets as possible stay EXACTLY as they
// are. So a run rewrites few connections (small git diffs) and areas stay where
// they were; the preview then applies only the most relevant changes.
//
// Method: iteratively reweighted least squares. Each term proposes a target
// position with a weight; every iteration moves each idea toward the weighted
// mean, then separates overlaps. The memory term is an L1 norm per connection
// (weight 1/|residual|): a satisfied connection is stiff and a violated one
// cheap, so the needed movement concentrates on few connections, and whole
// subtrees move rigidly with their root. The other terms are quadratic, so they
// only win where they are large.
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
  strength: number // the simulation's normalized connection force, 0.25 (thin sibling) to 0.75 (sole connection)
  flowShare?: number // flow normalized at both ends (0–1, 0 without flow); when given, it sets the strength with the importance weight
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

// A root's position is not a connection offset (nor that of the idea a
// network that is only a cycle starts from): it is stored per browser only,
// so moving it costs no file change.
export interface LayoutPlacement {
  id: string
  position: [number, number]
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
  placements: LayoutPlacement[]
}

// Stored offsets are rounded so a re-save of an unchanged layout is diff-free.
const OFFSET_DECIMALS = 2
const OFFSET_SCALE = 10 ** OFFSET_DECIMALS
export const roundOffset = (offset: readonly [number, number]): [number, number] =>
  [Math.round(offset[0] * OFFSET_SCALE) / OFFSET_SCALE, Math.round(offset[1] * OFFSET_SCALE) / OFFSET_SCALE]

// Weights are dimensionless: residuals are measured in radius sums.
const DEFAULT_ROOM = 4
const DEFAULT_WEIGHTS = {
  memory: 1, // keep stored offsets
  length: 3, // times connection strength: pull connections toward `room` long; the layout lab's strongest lever against crossings
  spread: 1, // rotate connections around an idea apart when they share too narrow an angle; ramps up over the run
  outward: 1.5, // a moving child goes to the half circle facing away from its grandparents
  // Per idea, connected or not, shared by its semantic pairs (its 12 most
  // similar ideas and those that count it among theirs); pulls toward
  // clearance · (1 + 2 · distance) radius sums. Higher brings unconnected
  // ideas closer to their similar ones but tangles the network: in the lab,
  // 0.1 against 1 on ideas left them 18 instead of 6 radius sums from the
  // closest similar idea, with 968 instead of 1537 crossings.
  semantic: 0.1,
  anchor: 0.05, // keeps every idea near where it was: the objective alone is translation invariant
  separation: 4, // pushes ideas closer than `space` apart, as one pull among the others so the iterations converge; strongest when they touch, 1 / (1 + gap in radius sums)
  space: 5, // radius sums every idea keeps from every other; connected ideas at most the spacing (their length term decides). At 3, ideas sat almost touching in large graphs
  importance: 0.5 // connection strength = 1 − importance + importance · flow share: 0 all equal, 1 in proportion to the flow (weak connections then fly far out)
}
// What the Layout panel lets you tune (the anchor is a mechanic). Settings
// saved before a setting existed lack it: `withLayoutDefaults` fills it in.
export const DEFAULT_LAYOUT_SETTINGS: Required<LayoutSettings> = (({ anchor: _anchor, ...weights }) => ({ spacing: DEFAULT_ROOM, ...weights }))(DEFAULT_WEIGHTS)
export const withLayoutDefaults = (settings: LayoutSettings | undefined): Required<LayoutSettings> => ({ ...DEFAULT_LAYOUT_SETTINGS, ...settings })
export const sameLayoutSettings = (left: LayoutSettings, right: LayoutSettings) =>
  (Object.keys(DEFAULT_LAYOUT_SETTINGS) as (keyof LayoutSettings)[]).every(key => withLayoutDefaults(left)[key] === withLayoutDefaults(right)[key])
export const layoutOptions = ({ spacing, ...weights }: LayoutSettings): LayoutOptions => ({ room: spacing, weights })
// The connections around an idea share this angle, each by its strength.
const SPREAD_ANGLE = 2 * Math.PI
// Cosine distance: a neighbour 0.1 closer weighs e times more. On a real graph
// unconnected ideas then land nearer their closest neighbours (16 vs 21
// radius sums) than with equal weights.
const SEMANTIC_SHARPNESS = 0.1
const SMOOTHING = 0.01 // keeps 1/|residual| finite

export function solveLayout(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  options: LayoutOptions = {}
): { positions: Map<string, [number, number]>; changes: LayoutChange[]; placements: LayoutPlacement[] } {
  const { iterations = 300, onProgress, progressEvery = 10 } = options
  const solver = createLayoutSolver(nodes, links, options)
  for (let iteration = 0; iteration < iterations; iteration++) {
    // Spread is weak at first, so branches can still pass each other, firm at the end.
    solver.step((iteration + 1) / iterations)
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
  { clearance = 3, room: initialRoom = DEFAULT_ROOM, semanticPairs = [], minimumChange = 0.05, weights: initialWeights = {} }: LayoutOptions = {}
) {
  let MEMORY = 0, LENGTH = 0, SPREAD = 0, OUTWARD = 0, SEMANTIC = 0, ANCHOR = 0, SEPARATION = 0, SPACE = 0, IMPORTANCE = 0
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
  const parentsOf = nodes.map(() => [] as number[])
  // Every connection of an idea, to parents and children alike.
  const around = nodes.map(() => [] as { other: number; isChild: boolean; edge: number }[])
  edges.forEach(({ child, parent }, edge) => {
    parentsOf[child]!.push(parent)
    around[parent]!.push({ other: child, isChild: true, edge })
    around[child]!.push({ other: parent, isChild: false, edge })
  })
  const strength = new Float64Array(edges.length) // per edge, from the importance setting
  const connected = new Set(edges.map(edge => edge.child * count + edge.parent))
  const pairs = semanticPairs.flatMap(pair => {
    const a = indexOf.get(pair.source)
    const b = indexOf.get(pair.target)
    if (a === undefined || b === undefined || a === b || connected.has(a * count + b) || connected.has(b * count + a)) return []
    return [{ a, b, distance: pair.distance, span: radius[a]! + radius[b]!, length: clearance * (1 + 2 * pair.distance) }]
  })
  // Each idea shares its semantic weight among its pairs, the closest ones
  // getting most (softmax over distance): pulled toward the mean of all its
  // neighbours, an idea would settle between them, next to none.
  const similarity = pairs.map(pair => Math.exp(-pair.distance / SEMANTIC_SHARPNESS))
  const similarityTotal = new Float64Array(count)
  pairs.forEach(({ a, b }, index) => {
    similarityTotal[a] = similarityTotal[a]! + similarity[index]!
    similarityTotal[b] = similarityTotal[b]! + similarity[index]!
  })
  const networkSize = connectedNetworkSizes(count, edges)
  const largestNetwork = Math.max(1, ...networkSize)
  // Outward and spread push only children, so the terms add up to a net drift
  // along the direction the tree grows; the anchor alone lets it build up
  // while the live solver keeps running. Translation is free for every other
  // term, so after each iteration the largest network's centre goes back
  // where it started (smaller networks may still move toward it). Not when
  // fixed ideas hold it in place anyway.
  const main = networkSize.flatMap((size, index) => size === largestNetwork ? [index] : [])
  const pinned = main.every(index => nodes[index]!.movable)

  const setSettings = ({ room: newRoom = room, weights = {} }: Pick<LayoutOptions, 'room' | 'weights'>) => {
    room = newRoom
    ;({ memory: MEMORY, length: LENGTH, spread: SPREAD, outward: OUTWARD, semantic: SEMANTIC, anchor: ANCHOR, separation: SEPARATION, space: SPACE, importance: IMPORTANCE } =
      { ...DEFAULT_WEIGHTS, ...weights })
    edges.forEach(({ link }, edge) => {
      strength[edge] = link.flowShare === undefined ? link.strength : 1 - IMPORTANCE + IMPORTANCE * link.flowShare
    })
  }
  setSettings({ room: initialRoom, weights: initialWeights })

  const seeds = placeFromStoredOffsets(nodes, edges, x, y)
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
  // Pulls `other` toward its position rotated by `angle` around `center`.
  const rotate = (center: number, other: number, angle: number, weight: number) => {
    const vx = x[other]! - x[center]!
    const vy = y[other]! - y[center]!
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    pull(other, weight, x[center]! + vx * cos - vy * sin, y[center]! + vx * sin + vy * cos)
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
    // Seeds are placed by position, not by an offset: roots, and the idea a
    // network that is only a cycle starts from.
    const placements = nodes.flatMap((node, index) => {
      if (!seeds[index] || !node.movable) return []
      const moved = Math.hypot(x[index]! - node.position[0], y[index]! - node.position[1]) / radius[index]!
      return moved > minimumChange ? [{ id: node.id, position: [x[index]!, y[index]!] as [number, number] }] : []
    })
    return { changes, placements }
  }

  const previousX = new Float64Array(count)
  const previousY = new Float64Array(count)
  // One iteration; spreadShare scales the spread term (0–1), stepSize is
  // the share of the way each idea moves toward its target. Returns the
  // largest move of an idea, in radius sums: near 0 once it has converged.
  const step = (spreadShare: number, stepSize = FREE_STEP): number => {
    previousX.set(x)
    previousY.set(y)
    for (let index = 0; index < count; index++) {
      const drift = Math.hypot(x[index]! - startX[index]!, y[index]! - startY[index]!) / radius[index]!
      sumX[index] = 0
      sumY[index] = 0
      sumWeight[index] = 0
      pull(index, ANCHOR / Math.max(drift, SMOOTHING), startX[index]!, startY[index]!)
    }

    for (const [edge, { child, parent, span, keepX, keepY }] of edges.entries()) {
      const vx = x[child]! - x[parent]!
      const vy = y[child]! - y[parent]!

      const memory = MEMORY / Math.max(Math.hypot(vx - keepX, vy - keepY) / span, SMOOTHING)
      pull(child, memory, x[parent]! + keepX, y[parent]! + keepY)
      pull(parent, memory, x[child]! - keepX, y[child]! - keepY)

      // Toward the spacing from both sides: longer connections shorten,
      // shorter ones lengthen.
      const length = Math.hypot(vx, vy)
      if (length > 0) {
        const scale = room * span / length
        pull(child, LENGTH * strength[edge]!, x[parent]! + vx * scale, y[parent]! + vy * scale)
        pull(parent, LENGTH * strength[edge]!, x[child]! - vx * scale, y[child]! - vy * scale)
      }

      // Seen from the grandparents, a child must not lie behind its parent:
      // pulled to the edge of the half circle facing away, so subdivision
      // keeps one direction without forcing children onto a single ray.
      const grandparents = parentsOf[parent]!
      if (grandparents.length > 0 && length > 0) {
        let awayX = 0
        let awayY = 0
        for (const grandparent of grandparents) {
          awayX += x[parent]! - x[grandparent]!
          awayY += y[parent]! - y[grandparent]!
        }
        const awayLength = Math.hypot(awayX, awayY)
        if (awayLength > 0) {
          awayX /= awayLength
          awayY /= awayLength
          const ahead = vx * awayX + vy * awayY
          if (ahead < 0) {
            let sideX = vx - ahead * awayX
            let sideY = vy - ahead * awayY
            const sideLength = Math.hypot(sideX, sideY)
            if (sideLength > 0) {
              sideX /= sideLength
              sideY /= sideLength
            } else {
              sideX = -awayY
              sideY = awayX
            }
            pull(child, OUTWARD, x[parent]! + sideX * length, y[parent]! + sideY * length)
          }
        }
      }
    }

    // Around each idea, neighbouring connections need an angle of at least
    // their strength share of SPREAD_ANGLE; tighter pairs rotate apart. Only
    // children rotate, parents stay put. Rotations push on through the next
    // neighbours, so a branch pulled to one side makes room on the other.
    // The push is constant, whatever the overlap (weight 1/overlap, like
    // memory): a pull stronger than it takes a branch past its neighbour,
    // which then pushes the other way, so branches can swap places. A push
    // growing with the overlap would be strongest exactly where they pass.
    const spread = SPREAD * spreadShare
    for (let center = 0; center < count; center++) {
      const connections = around[center]!
      if (connections.length < 2) continue
      let totalStrength = 0
      const angles = connections.map(connection => {
        totalStrength += strength[connection.edge]!
        return Math.atan2(y[connection.other]! - y[center]!, x[connection.other]! - x[center]!)
      })
      if (totalStrength <= 0) continue
      const sorted = connections.map((_, index) => index).sort((left, right) => angles[left]! - angles[right]!)
      for (let i = 0; i < sorted.length; i++) {
        const first = sorted[i]!
        const second = sorted[(i + 1) % sorted.length]!
        const gap = angles[second]! - angles[first]! + (i === sorted.length - 1 ? 2 * Math.PI : 0)
        const needed = SPREAD_ANGLE * (strength[connections[first]!.edge]! + strength[connections[second]!.edge]!) / 2 / totalStrength
        if (gap >= needed) continue
        const { other: firstOther, isChild: firstIsChild } = connections[first]!
        const { other: secondOther, isChild: secondIsChild } = connections[second]!
        if (!firstIsChild && !secondIsChild) continue
        const firstShare = firstIsChild ? (secondIsChild ? 0.5 : 1) : 0
        const push = spread / Math.max(needed - gap, SMOOTHING)
        if (firstShare > 0) rotate(center, firstOther, -(needed - gap) * firstShare, push)
        if (firstShare < 1) rotate(center, secondOther, (needed - gap) * (1 - firstShare), push)
      }
    }

    for (const [index, { a, b, span, length }] of pairs.entries()) {
      const vx = x[b]! - x[a]!
      const vy = y[b]! - y[a]!
      const distance = Math.hypot(vx, vy)
      if (distance <= length * span) continue
      const scale = length * span / distance
      pull(b, SEMANTIC * similarity[index]! / similarityTotal[b]!, x[a]! + vx * scale, y[a]! + vy * scale)
      pull(a, SEMANTIC * similarity[index]! / similarityTotal[a]!, x[b]! - vx * scale, y[b]! - vy * scale)
    }

    // Ideas closer than the space: each pulled to where the pair would be
    // just far enough apart. Pushing them apart outright after each
    // iteration (as `separate` does at the end) fights the other terms, and
    // the iterations cycle instead of coming to rest.
    const linkedSpace = Math.min(SPACE, room)
    forEachOverlap(x, y, radius, SPACE, order, (a, b, deltaX, deltaY, distance, minimum) => {
      const span = radius[a]! + radius[b]!
      if (minimum > linkedSpace * span && (connected.has(a * count + b) || connected.has(b * count + a))) {
        if (distance >= linkedSpace * span) return
        minimum = linkedSpace * span
      }
      const push = (minimum - distance) / distance
      // Strongest when they touch, half as strong one radius sum apart.
      const weight = SEPARATION / (1 + Math.max(distance / span - 1, 0))
      pull(a, weight, x[a]! - deltaX * push, y[a]! - deltaY * push)
      pull(b, weight, x[b]! + deltaX * push, y[b]! + deltaY * push)
    })

    for (let index = 0; index < count; index++) {
      if (!nodes[index]!.movable) continue
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
    for (const index of main) {
      driftX += x[index]! - startX[index]!
      driftY += y[index]! - startY[index]!
    }
    driftX /= main.length
    driftY /= main.length
    for (let index = 0; index < count; index++) {
      if (!nodes[index]!.movable) continue
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
const RELAX_DURATION = 5000 // ms instead, with a clock (the live panel): the same calm-down whatever the graph's size
const RELAX_CHUNK = 10 // iterations between results
const SPREAD_RAMP = 300 // the first iterations, while branches can still pass each other
// Each idea moves this share of the way to its target: the full step at
// first, shrinking linearly to the settled one by the end of the budget, so
// the solver calms down instead of oscillating until the budget cuts it off.
const FREE_STEP = 0.5
const SETTLED_STEP = 0.05
const CONVERGED = 0.2 // radius sums per full step: no idea's target was further in any iteration of a chunk

// Relaxes in chunks until converged or the budget (iterations, or with
// `now` milliseconds) is spent: what the worker and the lab both run.
export function createRelaxation(solver: LayoutSolver, { budget = RELAX_BUDGET, spreadRamp = SPREAD_RAMP, now }: { budget?: number; spreadRamp?: number; now?: () => number } = {}) {
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
      for (let step = 0; step < RELAX_CHUNK && progress() < 1; step++, sinceResume++, iterations++) {
        const stepSize = FREE_STEP + (SETTLED_STEP - FREE_STEP) * progress()
        largestMove = Math.max(largestMove, solver.step(Math.min(1, (iterations + 1) / spreadRamp), stepSize) / stepSize)
      }
      return { done: progress() >= 1 || (iterations >= spreadRamp && largestMove < CONVERGED), largestMove }
    },
    iterations: () => iterations
  }
}

/** The ideas of the largest connected network: what pinning the layout's centre refers to. */
export function largestNetworkIds(nodes: readonly LayoutNode[], links: readonly LayoutLink[]): Set<string> {
  const indexOf = new Map(nodes.map((node, index) => [node.id, index]))
  const edges = links.flatMap(link => {
    const child = indexOf.get(link.childId)
    const parent = indexOf.get(link.parentId)
    return child === undefined || parent === undefined ? [] : [{ child, parent }]
  })
  const sizes = connectedNetworkSizes(nodes.length, edges)
  const largest = Math.max(0, ...sizes)
  return new Set(nodes.flatMap((node, index) => sizes[index] === largest ? [node.id] : []))
}

// Ideas per connected network (connection direction ignored), for each idea.
function connectedNetworkSizes(count: number, edges: readonly { child: number; parent: number }[]): number[] {
  const root = Array.from({ length: count }, (_, index) => index)
  const find = (index: number): number => {
    while (root[index] !== index) index = root[index] = root[root[index]!]!
    return index
  }
  for (const { child, parent } of edges) root[find(child)] = find(parent)
  const size = new Map<number, number>()
  for (let index = 0; index < count; index++) size.set(find(index), (size.get(find(index)) ?? 0) + 1)
  return root.map((_, index) => size.get(find(index))!)
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
// Returns which ideas were seeds, kept where they were.
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
  const seeds = new Uint8Array(nodes.length)
  const queue: number[] = []
  const place = (index: number) => {
    placed[index] = 1
    queue.push(index)
  }
  const seed = (index: number) => {
    if (placed[index]) return
    seeds[index] = 1
    place(index)
  }
  const drain = () => {
    while (queue.length > 0) {
      const parent = queue.shift()!
      for (const edge of childEdges[parent]!) {
        if (placed[edge.child]) continue
        x[edge.child] = x[parent]! + edge.dx
        y[edge.child] = y[parent]! + edge.dy
        place(edge.child)
      }
    }
  }
  nodes.forEach((node, index) => { if (!hasParent[index] || !node.movable) seed(index) })
  drain()
  // Ideas only reachable through a cycle keep their current position as a seed.
  nodes.forEach((_, index) => { seed(index); drain() })
  return seeds
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
