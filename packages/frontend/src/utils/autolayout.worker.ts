// Runs the live layout solver off the main thread. One solver per Layout
// panel: it relaxes in chunks, streaming the result after each, until it has
// converged; a settings change continues from the current state, so small
// changes move little.
import type { LayoutSettings } from 'shared'
import { createLayoutSolver, layoutOptions, type LayoutLink, type LayoutNode, type LayoutProgress, type LayoutSolver, type SemanticPair } from './autolayout'

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

const ITERATIONS = 600 // at most, after the start and after every settings change
const CHUNK = 10 // iterations between streamed results
const SPREAD_RAMP = 300 // the first iterations, while branches can still pass each other
const CONVERGED = 0.1 // radius sums: no idea moved further in any iteration of a chunk

let solver: LayoutSolver | null = null
let iterations = 0
let remaining = 0
let running = false

const run = () => {
  if (!solver) return
  let largestMove = 0
  for (let step = 0; step < CHUNK && remaining > 0; step++, remaining--, iterations++) {
    largestMove = Math.max(largestMove, solver.step(Math.min(1, (iterations + 1) / SPREAD_RAMP)))
  }
  const done = remaining === 0 || (iterations >= SPREAD_RAMP && largestMove < CONVERGED)
  if (done) solver.finish()
  self.postMessage({ ...solver.result(), done } satisfies LayoutResult)
  running = !done
  // Yields between chunks, so a settings message gets in.
  if (running) setTimeout(run)
}

self.onmessage = ({ data }: MessageEvent<LayoutMessage>) => {
  if ('start' in data) {
    const { nodes, links, semanticPairs, settings } = data.start
    solver = createLayoutSolver(nodes, links, { ...layoutOptions(settings), semanticPairs })
    iterations = 0
  } else {
    solver?.setSettings(layoutOptions(data.settings))
  }
  remaining = ITERATIONS
  if (!running) {
    running = true
    setTimeout(run)
  }
}
