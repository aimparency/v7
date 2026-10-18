// Runs the live layout solver off the main thread. One solver per Layout
// panel: it relaxes in chunks, streaming the result after each, as long as
// the panel is open; steps calm down over 5 s after the start or a change. A
// settings change continues from the current state, so small changes move
// little.
import type { LayoutSettings } from 'shared'
import { createLayoutSolver, createRelaxation, layoutOptions, type LayoutLink, type LayoutNode, type LayoutProgress, type LayoutSolver, type SemanticPair } from './autolayout'

export interface LayoutRequest {
  nodes: LayoutNode[]
  links: LayoutLink[]
  semanticPairs: SemanticPair[]
  settings: LayoutSettings
}

export type LayoutMessage = { start: LayoutRequest } | { settings: LayoutSettings }

export interface LayoutResult extends LayoutProgress {
  done: boolean
}

let solver: LayoutSolver | null = null
let relaxation: ReturnType<typeof createRelaxation> | null = null
let start: LayoutRequest | null = null
let calm = false
let running = false

const run = () => {
  if (!solver || !relaxation) return
  const { done } = relaxation.chunk()
  self.postMessage({ ...solver.result(), done } satisfies LayoutResult)
  if (done && !calm) report()
  calm = done
  // Yields between chunks, so a settings message gets in.
  setTimeout(run)
}

// Once per calm-down, in the browser console: how far ideas have moved from
// where the panel started, to tell a solver that moves nothing from one whose
// moves don't show.
const report = () => {
  if (!solver || !start) return
  const positions = solver.positions()
  const moved = start.nodes.map(node => {
    const [x, y] = positions.get(node.id)!
    return Math.hypot(x - node.position[0], y - node.position[1]) / (2 * node.radius)
  }).sort((left, right) => left - right)
  const ids = new Set(start.nodes.map(node => node.id))
  const pairs = start.semanticPairs.filter(pair => ids.has(pair.source) && ids.has(pair.target)).length
  console.info(`[autolayout] calmed down after ${relaxation!.iterations()} iterations; ideas moved (diameters) median ${moved[moved.length >> 1]?.toFixed(1)}, 90% ${moved[Math.floor(moved.length * 0.9)]?.toFixed(1)}, max ${moved.at(-1)?.toFixed(1)}; similarity pairs ${pairs} of ${start.semanticPairs.length}`)
}

self.onmessage = ({ data }: MessageEvent<LayoutMessage>) => {
  if ('start' in data) {
    start = data.start
    const { nodes, links, semanticPairs, settings } = data.start
    solver = createLayoutSolver(nodes, links, { ...layoutOptions(settings), semanticPairs })
    relaxation = createRelaxation(solver, { now: () => performance.now() })
  } else {
    solver?.setSettings(layoutOptions(data.settings))
    relaxation?.resume()
  }
  calm = false
  if (!running) {
    running = true
    setTimeout(run)
  }
}
