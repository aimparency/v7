/**
 * Quadtree Spatial Index
 *
 * Fast spatial data structure for viewport culling and hit testing.
 * Partitions 2D space into quadrants recursively.
 */

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface Point {
  x: number
  y: number
}

export interface QuadtreeItem {
  id: string
  x: number
  y: number
  r: number // radius for bounds calculation
}

interface QuadtreeNode {
  bounds: Bounds
  items: QuadtreeItem[]
  children: QuadtreeNode[] | null
  depth: number
}

export class Quadtree {
  private root: QuadtreeNode
  private maxItems: number
  private maxDepth: number

  constructor(bounds: Bounds, maxItems = 8, maxDepth = 8) {
    this.maxItems = maxItems
    this.maxDepth = maxDepth
    this.root = {
      bounds,
      items: [],
      children: null,
      depth: 0
    }
  }

  /**
   * Clear the tree and rebuild from items
   */
  build(items: QuadtreeItem[]): void {
    // Clear existing tree
    this.root.items = []
    this.root.children = null

    // Insert all items
    for (const item of items) {
      this.insert(item)
    }
  }

  /**
   * Insert an item into the tree
   */
  insert(item: QuadtreeItem): void {
    this.insertIntoNode(this.root, item)
  }

  private insertIntoNode(node: QuadtreeNode, item: QuadtreeItem): void {
    // Check if item bounds intersect node bounds
    const itemBounds = this.getItemBounds(item)
    if (!this.boundsIntersect(itemBounds, node.bounds)) {
      return
    }

    // If node has children, insert into appropriate child
    if (node.children) {
      for (const child of node.children) {
        this.insertIntoNode(child, item)
      }
      return
    }

    // Add to this node
    node.items.push(item)

    // Split if needed
    if (node.items.length > this.maxItems && node.depth < this.maxDepth) {
      this.split(node)
    }
  }

  /**
   * Split a node into 4 quadrants
   */
  private split(node: QuadtreeNode): void {
    const { minX, minY, maxX, maxY } = node.bounds
    const midX = (minX + maxX) / 2
    const midY = (minY + maxY) / 2
    const depth = node.depth + 1

    // Create 4 children (NW, NE, SW, SE)
    node.children = [
      // NW (top-left)
      {
        bounds: { minX, minY, maxX: midX, maxY: midY },
        items: [],
        children: null,
        depth
      },
      // NE (top-right)
      {
        bounds: { minX: midX, minY, maxX, maxY: midY },
        items: [],
        children: null,
        depth
      },
      // SW (bottom-left)
      {
        bounds: { minX, minY: midY, maxX: midX, maxY },
        items: [],
        children: null,
        depth
      },
      // SE (bottom-right)
      {
        bounds: { minX: midX, minY: midY, maxX, maxY },
        items: [],
        children: null,
        depth
      }
    ]

    // Redistribute items to children
    const items = node.items
    node.items = []

    for (const item of items) {
      for (const child of node.children) {
        this.insertIntoNode(child, item)
      }
    }
  }

  /**
   * Query items that intersect with given bounds
   */
  query(bounds: Bounds): QuadtreeItem[] {
    const results: QuadtreeItem[] = []
    const seen = new Set<string>()
    this.queryNode(this.root, bounds, results, seen)
    return results
  }

  private queryNode(
    node: QuadtreeNode,
    bounds: Bounds,
    results: QuadtreeItem[],
    seen: Set<string>
  ): void {
    // Check if query bounds intersect node bounds
    if (!this.boundsIntersect(bounds, node.bounds)) {
      return
    }

    // If node has children, query them
    if (node.children) {
      for (const child of node.children) {
        this.queryNode(child, bounds, results, seen)
      }
      return
    }

    // Check each item in this node
    for (const item of node.items) {
      // Avoid duplicates (items can be in multiple leaf nodes)
      if (seen.has(item.id)) continue

      const itemBounds = this.getItemBounds(item)
      if (this.boundsIntersect(itemBounds, bounds)) {
        results.push(item)
        seen.add(item.id)
      }
    }
  }

  /**
   * Find item at point (with radius tolerance)
   */
  queryPoint(x: number, y: number, tolerance = 0): QuadtreeItem | null {
    const bounds: Bounds = {
      minX: x - tolerance,
      minY: y - tolerance,
      maxX: x + tolerance,
      maxY: y + tolerance
    }

    const candidates = this.query(bounds)

    // Find closest item
    let closest: QuadtreeItem | null = null
    let closestDist = Infinity

    for (const item of candidates) {
      const dx = item.x - x
      const dy = item.y - y
      const dist = Math.sqrt(dx * dx + dy * dy)

      // Check if point is within item's bounds (including its radius)
      if (dist <= item.r + tolerance && dist < closestDist) {
        closest = item
        closestDist = dist
      }
    }

    return closest
  }

  /**
   * Get bounding box for an item (includes radius)
   */
  private getItemBounds(item: QuadtreeItem): Bounds {
    return {
      minX: item.x - item.r,
      minY: item.y - item.r,
      maxX: item.x + item.r,
      maxY: item.y + item.r
    }
  }

  /**
   * Check if two bounds intersect
   */
  private boundsIntersect(a: Bounds, b: Bounds): boolean {
    return !(
      a.maxX < b.minX ||
      a.minX > b.maxX ||
      a.maxY < b.minY ||
      a.minY > b.maxY
    )
  }

  /**
   * Get statistics about the tree (for debugging)
   */
  getStats(): {
    totalNodes: number
    leafNodes: number
    totalItems: number
    maxDepth: number
    avgItemsPerLeaf: number
  } {
    const stats = {
      totalNodes: 0,
      leafNodes: 0,
      totalItems: 0,
      maxDepth: 0
    }

    const traverse = (node: QuadtreeNode) => {
      stats.totalNodes++
      stats.maxDepth = Math.max(stats.maxDepth, node.depth)

      if (node.children) {
        for (const child of node.children) {
          traverse(child)
        }
      } else {
        stats.leafNodes++
        stats.totalItems += node.items.length
      }
    }

    traverse(this.root)

    return {
      ...stats,
      avgItemsPerLeaf: stats.leafNodes > 0 ? stats.totalItems / stats.leafNodes : 0
    }
  }

  /**
   * Update a single item's position (incremental update)
   * Note: This is expensive as it requires finding and removing the item first.
   * For frequent updates, consider rebuilding the entire tree.
   */
  update(itemId: string, newX: number, newY: number, newR: number): boolean {
    // Remove old entry
    const removed = this.remove(itemId)
    if (!removed) return false

    // Insert with new position
    this.insert({ id: itemId, x: newX, y: newY, r: newR })
    return true
  }

  /**
   * Remove an item from the tree
   */
  private remove(itemId: string): boolean {
    return this.removeFromNode(this.root, itemId)
  }

  private removeFromNode(node: QuadtreeNode, itemId: string): boolean {
    if (node.children) {
      let removed = false
      for (const child of node.children) {
        if (this.removeFromNode(child, itemId)) {
          removed = true
        }
      }
      return removed
    }

    const index = node.items.findIndex(item => item.id === itemId)
    if (index >= 0) {
      node.items.splice(index, 1)
      return true
    }

    return false
  }

  /**
   * Get the bounds of the entire tree
   */
  getBounds(): Bounds {
    return { ...this.root.bounds }
  }
}
