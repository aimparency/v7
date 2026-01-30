/**
 * WebGL Interaction Manager
 *
 * Handles mouse/touch interaction with the WebGL graph using CPU-based hit testing.
 * Uses the spatial tree (Quadtree) for efficient picking.
 */

import type { Quadtree } from './spatial/Quadtree'
import type { ArrowGeometry } from './utils/arrow-geometry'

export interface Vec2 {
  x: number
  y: number
}

export interface NodeData {
  id: string
  x: number
  y: number
  r: number
}

export interface EdgeData {
  id: string
  sourceId: string
  targetId: string
  geometry: ArrowGeometry
}

export class InteractionManager {
  private canvas: HTMLCanvasElement
  private quadtree: Quadtree | null = null
  private nodes: Map<string, NodeData> = new Map()
  private edges: Map<string, EdgeData> = new Map()

  // Camera state
  private viewMatrix: Float32Array = new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ])

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
  }

  /**
   * Update spatial tree reference
   */
  setQuadtree(quadtree: Quadtree | null): void {
    this.quadtree = quadtree
  }

  /**
   * Update node data for hit testing
   */
  updateNodes(nodes: NodeData[]): void {
    this.nodes.clear()
    for (const node of nodes) {
      this.nodes.set(node.id, node)
    }
  }

  /**
   * Update edge data for hit testing
   */
  updateEdges(edges: EdgeData[]): void {
    this.edges.clear()
    for (const edge of edges) {
      this.edges.set(edge.id, edge)
    }
  }

  /**
   * Update camera matrix
   */
  setCamera(viewMatrix: Float32Array): void {
    this.viewMatrix = viewMatrix
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  screenToWorld(screenX: number, screenY: number): Vec2 {
    // Extract camera parameters from view matrix
    // View matrix format:
    // [zoom, 0, panX]
    // [0, zoom, panY]
    // [0, 0, 1]
    const zoom = this.viewMatrix[0]
    const panX = this.viewMatrix[6]
    const panY = this.viewMatrix[7]

    const width = this.canvas.width
    const height = this.canvas.height

    // Screen coords are in pixels (0,0 is top-left)
    // First convert to view space (accounting for pan)
    const viewX = screenX
    const viewY = screenY

    // Then apply inverse transform: world = (view - pan) / zoom
    const worldX = (viewX - panX) / zoom
    const worldY = (viewY - panY) / zoom

    return { x: worldX, y: worldY }
  }

  /**
   * Find node at screen position
   * Returns node ID if found, null otherwise
   */
  findNodeAt(screenX: number, screenY: number, tolerance: number = 0): string | null {
    if (!this.quadtree) return null

    const worldPos = this.screenToWorld(screenX, screenY)

    // Convert tolerance from screen pixels to world units
    const zoom = this.viewMatrix[0]
    const worldTolerance = tolerance / zoom

    // Query spatial tree for nearby nodes
    const queryRadius = worldTolerance
    const bounds = {
      minX: worldPos.x - queryRadius,
      minY: worldPos.y - queryRadius,
      maxX: worldPos.x + queryRadius,
      maxY: worldPos.y + queryRadius
    }

    const candidates = this.quadtree.query(bounds)

    // Find closest node within radius
    let closestNode: string | null = null
    let closestDistance = Infinity

    for (const item of candidates) {
      const node = this.nodes.get(item.id)
      if (!node) continue

      // Calculate distance from click point to node center
      const dx = worldPos.x - node.x
      const dy = worldPos.y - node.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      // Check if within node radius + tolerance
      if (distance <= node.r + worldTolerance && distance < closestDistance) {
        closestDistance = distance
        closestNode = node.id
      }
    }

    return closestNode
  }

  /**
   * Find edge near screen position
   * Returns edge ID if found, null otherwise
   */
  findEdgeAt(screenX: number, screenY: number, tolerance: number = 10): string | null {
    const worldPos = this.screenToWorld(screenX, screenY)

    // Convert tolerance from screen pixels to world units
    const zoom = this.viewMatrix[0]
    const worldTolerance = tolerance / zoom

    // Check all edges (in the future, could use spatial indexing for edges too)
    let closestEdge: string | null = null
    let closestDistance = Infinity

    for (const [edgeId, edge] of this.edges) {
      const distance = this.pointToArrowDistance(worldPos, edge.geometry)

      if (distance <= worldTolerance && distance < closestDistance) {
        closestDistance = distance
        closestEdge = edgeId
      }
    }

    return closestEdge
  }

  /**
   * Calculate distance from a point to an arrow
   * This is a simplified version - for more accuracy, would need to check
   * distance to the actual arc path
   */
  private pointToArrowDistance(point: Vec2, geometry: ArrowGeometry): number {
    // Simplified: check distance to line segment from start to end
    const start = geometry.trunk.startPos
    const end = geometry.trunk.endPos

    // Vector from start to end
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSq = dx * dx + dy * dy

    if (lengthSq === 0) {
      // Start and end are the same point
      const pdx = point.x - start.x
      const pdy = point.y - start.y
      return Math.sqrt(pdx * pdx + pdy * pdy)
    }

    // Project point onto line segment
    const t = Math.max(0, Math.min(1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq
    ))

    // Find closest point on segment
    const closestX = start.x + t * dx
    const closestY = start.y + t * dy

    // Calculate distance
    const distX = point.x - closestX
    const distY = point.y - closestY
    return Math.sqrt(distX * distX + distY * distY)
  }

  /**
   * Get node under cursor (with default tolerance)
   */
  getNodeUnderCursor(screenX: number, screenY: number): string | null {
    return this.findNodeAt(screenX, screenY, 0)
  }

  /**
   * Get edge near cursor (with default tolerance)
   */
  getEdgeNearCursor(screenX: number, screenY: number): string | null {
    return this.findEdgeAt(screenX, screenY, 10)
  }

  /**
   * Handle mouse move event
   * Returns object with node and edge under cursor
   */
  handleMouseMove(event: MouseEvent): { node: string | null; edge: string | null } {
    const rect = this.canvas.getBoundingClientRect()
    const screenX = event.clientX - rect.left
    const screenY = event.clientY - rect.top

    // Try to find node first (nodes have priority over edges)
    const node = this.findNodeAt(screenX, screenY, 5)

    // If no node found, try to find edge
    const edge = node ? null : this.findEdgeAt(screenX, screenY, 10)

    return { node, edge }
  }

  /**
   * Handle mouse click event
   */
  handleClick(event: MouseEvent): { node: string | null; edge: string | null } {
    const rect = this.canvas.getBoundingClientRect()
    const screenX = event.clientX - rect.left
    const screenY = event.clientY - rect.top

    const node = this.findNodeAt(screenX, screenY, 5)
    const edge = node ? null : this.findEdgeAt(screenX, screenY, 10)

    return { node, edge }
  }
}
