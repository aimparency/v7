// Runs the layout solver off the main thread (hundreds of ms on large graphs).
import { solveLayout, type LayoutChange, type LayoutLink, type LayoutNode, type LayoutPlacement, type SemanticPair } from './autolayout'

export interface LayoutRequest {
  nodes: LayoutNode[]
  links: LayoutLink[]
  semanticPairs: SemanticPair[]
}

export interface LayoutResult {
  changes: LayoutChange[]
  placements: LayoutPlacement[]
}

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { nodes, links, semanticPairs } = event.data
  const { changes, placements } = solveLayout(nodes, links, { semanticPairs })
  self.postMessage({ changes, placements } satisfies LayoutResult)
}
