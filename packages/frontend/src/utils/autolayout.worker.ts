// Runs the live layout solver off the main thread. One solver per Layout
// panel: it relaxes in chunks, streaming the result after each, until it has
// converged; a settings change continues from the current state, so small
// changes move little.
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
let running = false

const run = () => {
  if (!solver || !relaxation) return
  const { done } = relaxation.chunk()
  self.postMessage({ ...solver.result(), done } satisfies LayoutResult)
  running = !done
  // Yields between chunks, so a settings message gets in.
  if (running) setTimeout(run)
}

self.onmessage = ({ data }: MessageEvent<LayoutMessage>) => {
  if ('start' in data) {
    const { nodes, links, semanticPairs, settings } = data.start
    solver = createLayoutSolver(nodes, links, { ...layoutOptions(settings), semanticPairs })
    relaxation = createRelaxation(solver)
  } else {
    solver?.setSettings(layoutOptions(data.settings))
    relaxation?.resume()
  }
  if (!running) {
    running = true
    setTimeout(run)
  }
}
