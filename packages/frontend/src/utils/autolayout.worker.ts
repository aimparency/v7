// Runs the layout solver off the main thread (hundreds of ms on large graphs)
// and streams the result so far, so the preview moves while it solves.
import type { LayoutSettings } from 'shared'
import { layoutOptions, solveLayout, type LayoutLink, type LayoutNode, type LayoutProgress, type SemanticPair } from './autolayout'

export interface LayoutRequest {
  nodes: LayoutNode[]
  links: LayoutLink[]
  semanticPairs: SemanticPair[]
  settings: LayoutSettings
}

export interface LayoutResult extends LayoutProgress {
  done: boolean
}

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { nodes, links, semanticPairs, settings } = event.data
  const onProgress = (progress: LayoutProgress) => self.postMessage({ ...progress, done: false } satisfies LayoutResult)
  const { changes, placements } = solveLayout(nodes, links, { ...layoutOptions(settings), semanticPairs, onProgress })
  self.postMessage({ changes, placements, done: true } satisfies LayoutResult)
}
