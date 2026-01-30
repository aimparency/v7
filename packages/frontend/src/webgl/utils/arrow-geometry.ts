/**
 * Arrow Geometry Calculation
 *
 * Computes geometric parameters for arc-based arrow rendering.
 * Based on the NEW_ARROWS.md specification.
 */

export interface Vec2 {
  x: number
  y: number
}

export interface NodeGeometry {
  x: number
  y: number
  r: number // radius
}

export interface ArrowGeometry {
  // Trunk parameters
  trunk: {
    startPos: Vec2           // Supporting aim center
    endPos: Vec2             // Point where arrow touches supported aim
    arcCenter1: Vec2         // Inner arc center (M1)
    arcCenter2: Vec2         // Outer arc center (M2)
    radiusInnerSq: number    // Inner radius squared (r1s)
    radiusOuterSq: number    // Outer radius squared (r2s)
    radiusCenterSq: number   // Center radius squared (for tapering)
    taperFactor: number      // How much to taper (0.0 = no taper, 1.0 = full taper)
  }

  // Head parameters
  head: {
    tailPos: Vec2            // Connection point to trunk
    pointPos: Vec2           // Tip of arrow (same as trunk endPos)
    arcCenter1: Vec2         // Inner arc center (M1)
    arcCenter2: Vec2         // Outer arc center (M2)
    radiusInner: number      // Inner radius at tail (r1)
    radiusOuter: number      // Outer radius at tail (r2)
    radiusCenter: number     // Center radius
  }
}

export interface ArrowStyle {
  baseWidth: number          // Base width of arrow trunk
  curvature: number          // Arc curvature factor (0 = straight, higher = more curved)
  headLength: number         // Length of arrow head
  taperFactor: number        // How much trunk tapers (0.0 = no taper, 1.0 = full taper)
  minWidth: number           // Minimum arrow width (for weight visualization)
  maxWidth: number           // Maximum arrow width (for weight visualization)
}

const DEFAULT_STYLE: ArrowStyle = {
  baseWidth: 2.0,
  curvature: 0.3,
  headLength: 12.0,
  taperFactor: 0.7,
  minWidth: 1.0,
  maxWidth: 4.0
}

/**
 * Calculate arrow geometry from source and target nodes
 */
export function calculateArrowGeometry(
  source: NodeGeometry,
  target: NodeGeometry,
  weight: number = 1.0,  // Edge weight (0.0 to 1.0, where 1.0 is max weight)
  style: Partial<ArrowStyle> = {}
): ArrowGeometry {
  const s = { ...DEFAULT_STYLE, ...style }

  // Calculate direction vector from source to target
  const dx = target.x - source.x
  const dy = target.y - source.y
  const distance = Math.sqrt(dx * dx + dy * dy)

  // Normalize direction
  const dirX = dx / distance
  const dirY = dy / distance

  // Arrow starts at source center
  const startPos: Vec2 = { x: source.x, y: source.y }

  // Arrow ends at target circle edge
  const endPos: Vec2 = {
    x: target.x - dirX * target.r,
    y: target.y - dirY * target.r
  }

  // Calculate effective arrow length (after subtracting target radius)
  const arrowLength = distance - target.r

  // Calculate perpendicular vector (for arc centers)
  const perpX = -dirY
  const perpY = dirX

  // Calculate arc centers based on curvature
  // Place them perpendicular to the arrow direction
  const arcOffset = arrowLength * s.curvature

  // Midpoint of arrow
  const midX = (startPos.x + endPos.x) / 2
  const midY = (startPos.y + endPos.y) / 2

  // Arc centers (offset from midpoint)
  const arcCenter1: Vec2 = {
    x: midX + perpX * arcOffset,
    y: midY + perpY * arcOffset
  }

  const arcCenter2: Vec2 = {
    x: midX - perpX * arcOffset,
    y: midY - perpY * arcOffset
  }

  // Calculate width based on edge weight
  // Formula from NEW_ARROWS.md: widthScale = mix(minWidth, maxWidth, normalizedWeight)
  const normalizedWeight = Math.max(0.0, Math.min(1.0, weight))
  const widthScale = s.minWidth + (s.maxWidth - s.minWidth) * normalizedWeight
  const effectiveWidth = s.baseWidth * widthScale

  // Calculate radii based on arc geometry
  // Distance from arc center to arrow line determines radius
  const halfWidth = effectiveWidth / 2

  // For simplicity, use distance from arc center to endpoints
  const r1Dx = startPos.x - arcCenter1.x
  const r1Dy = startPos.y - arcCenter1.y
  const radiusInner = Math.sqrt(r1Dx * r1Dx + r1Dy * r1Dy) - halfWidth

  const r2Dx = startPos.x - arcCenter2.x
  const r2Dy = startPos.y - arcCenter2.y
  const radiusOuter = Math.sqrt(r2Dx * r2Dx + r2Dy * r2Dy) + halfWidth

  const radiusCenter = (radiusInner + radiusOuter) / 2

  // Trunk parameters (using squared radii for shader efficiency)
  const trunk = {
    startPos,
    endPos,
    arcCenter1,
    arcCenter2,
    radiusInnerSq: radiusInner * radiusInner,
    radiusOuterSq: radiusOuter * radiusOuter,
    radiusCenterSq: radiusCenter * radiusCenter,
    taperFactor: s.taperFactor
  }

  // Calculate arrow head geometry
  // Head starts where trunk ends and extends backward
  const headTailPos: Vec2 = {
    x: endPos.x - dirX * s.headLength,
    y: endPos.y - dirY * s.headLength
  }

  const head = {
    tailPos: headTailPos,
    pointPos: endPos,
    arcCenter1,
    arcCenter2,
    radiusInner,
    radiusOuter,
    radiusCenter
  }

  return { trunk, head }
}

/**
 * Calculate arrow geometries for multiple edges
 */
export function calculateArrowGeometries(
  edges: Array<{ sourceId: string; targetId: string; weight?: number }>,
  nodes: Map<string, NodeGeometry>,
  style: Partial<ArrowStyle> = {}
): Map<string, ArrowGeometry> {
  const geometries = new Map<string, ArrowGeometry>()

  for (const edge of edges) {
    const source = nodes.get(edge.sourceId)
    const target = nodes.get(edge.targetId)

    if (!source || !target) {
      console.warn(`Missing node for edge ${edge.sourceId} -> ${edge.targetId}`)
      continue
    }

    const edgeKey = `${edge.sourceId}->${edge.targetId}`
    const weight = edge.weight !== undefined ? edge.weight : 1.0
    geometries.set(edgeKey, calculateArrowGeometry(source, target, weight, style))
  }

  return geometries
}
