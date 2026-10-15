// Runs the layout solver off the main thread (hundreds of ms on large graphs).
import { solveLayout, type LayoutLink, type LayoutNode, type SemanticPair } from './autolayout'

export interface LayoutRequest {
  nodes: LayoutNode[]
  links: LayoutLink[]
  semanticPairs: SemanticPair[]
}

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { nodes, links, semanticPairs } = event.data
  self.postMessage(solveLayout(nodes, links, { semanticPairs }).changes)
}
