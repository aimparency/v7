/**
 * Arrow Geometry Calculation (Simplified Arc-Based)
 *
 * The arrow is an annulus segment (ring slice) with:
 * - Single arc center M on the perpendicular bisector of S→T
 * - Two radii: r1 (outer), r2 (inner), where width = r1 - r2
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
  // Arc geometry (single center M)
  arcCenter: Vec2           // M - shared arc center
  centerRadius: number      // Distance from M to arc centerline
  normalizedHalfWidth: number  // (halfWidth / centerRadius) - for normalized checks
  trunkLength: number       // Precomputed: where trunk ends and head begins (0-1)

  // Precomputed normalized direction from M to S (for start bound cross product)
  sourceDirX: number        // (S.x - M.x) / centerRadius
  sourceDirY: number        // (S.y - M.y) / centerRadius

  // Target info for end bound (world coords)
  targetCenter: Vec2        // T
  targetRadiusSq: number    // For end bound check

  // Triangle vertices (world coords for vertex shader)
  triangleV1: Vec2          // Towards S (source side)
  triangleV2: Vec2          // Towards tip (target side)
}

export interface ArrowStyle {
  curvature: number       // How far M is from midpoint (as factor of |S-T|)
  widthFactor: number     // Multiplier for share-based width (like SVG's 1.2)
}

const DEFAULT_STYLE: ArrowStyle = {
  curvature: 0.5,         // M is at |S-T| * 0.5 from midpoint
  widthFactor: 1.2        // Match SVG: width = widthFactor * targetR * share
}

/**
 * Find intersection points of two circles
 * Returns null if no intersection, otherwise returns the two points
 */
function circleCircleIntersection(
  c1: Vec2, r1: number,
  c2: Vec2, r2: number
): [Vec2, Vec2] | null {
  const dx = c2.x - c1.x
  const dy = c2.y - c1.y
  const d = Math.sqrt(dx * dx + dy * dy)

  // No intersection cases
  if (d > r1 + r2 || d < Math.abs(r1 - r2) || d < 0.0001) {
    return null
  }

  // Distance from c1 to the line connecting intersection points
  const a = (d * d + r1 * r1 - r2 * r2) / (2 * d)
  const hSq = r1 * r1 - a * a
  if (hSq < 0) return null
  const h = Math.sqrt(hSq)

  // Direction and perpendicular
  const dirX = dx / d
  const dirY = dy / d
  const perpX = -dirY
  const perpY = dirX

  // Midpoint on the line between intersection points
  const midX = c1.x + a * dirX
  const midY = c1.y + a * dirY

  // Two intersection points
  return [
    { x: midX + h * perpX, y: midY + h * perpY },
    { x: midX - h * perpX, y: midY - h * perpY }
  ]
}

/**
 * Calculate arrow geometry from source and target nodes
 * @param share - The contribution share (0-1), determines arrow width like SVG
 */
export function calculateArrowGeometry(
  source: NodeGeometry,
  target: NodeGeometry,
  share: number = 0.5,
  style: Partial<ArrowStyle> = {}
): ArrowGeometry {
  const s = { ...DEFAULT_STYLE, ...style }

  // Source and target centers
  const S: Vec2 = { x: source.x, y: source.y }
  const T: Vec2 = { x: target.x, y: target.y }

  // Vector from S to T
  const dx = T.x - S.x
  const dy = T.y - S.y
  const dist = Math.sqrt(dx * dx + dy * dy)

  if (dist < 0.001) {
    // Degenerate case: source and target at same position
    return createDegenerateGeometry(S, T, target.r)
  }

  // Normalized direction
  const dirX = dx / dist
  const dirY = dy / dist

  // Perpendicular (rotate 90° clockwise for consistent curve direction)
  const perpX = dirY
  const perpY = -dirX

  // Midpoint
  const midX = (S.x + T.x) / 2
  const midY = (S.y + T.y) / 2

  // Arc center M: midpoint + perpendicular * dist * curvature
  const M: Vec2 = {
    x: midX + perpX * dist * s.curvature,
    y: midY + perpY * dist * s.curvature
  }

  // Distance from M to S (and M to T, which is the same by symmetry)
  const msX = S.x - M.x
  const msY = S.y - M.y
  const centerRadius = Math.sqrt(msX * msX + msY * msY)

  // Arrow width based on share (matching SVG: width = widthFactor * targetR * share)
  const halfWidth = s.widthFactor * target.r * share / 2

  // Normalized half-width (for normalized distance checks in shader)
  const normalizedHalfWidth = halfWidth / centerRadius

  // Precompute trunk length: head takes ~4/3x the normalized width
  const headLength = Math.min((4 / 3) * normalizedHalfWidth, 0.5)  // Cap at 50% of arc
  const trunkLength = 1.0 - headLength

  // For triangle extension, compute outer radius
  const radiusOuter = centerRadius + halfWidth

  // Normalized direction from M to S (reuse for fallbacks)
  const msDirX = msX / centerRadius
  const msDirY = msY / centerRadius

  // Calculate tip point: intersection of centerline circle (M, centerRadius) and target circle (T, targetR)
  // Since |M-T| = centerRadius (M is on perpendicular bisector), T is ON the centerline circle
  // So we find where circle(T, targetR) intersects circle(M, centerRadius)
  const tipIntersections = circleCircleIntersection(M, centerRadius, T, target.r)
  let tipDirX: number, tipDirY: number
  if (tipIntersections) {
    // Pick intersection on short arc side (cross with M→S direction <= 0)
    const tip0X = tipIntersections[0].x - M.x
    const tip0Y = tipIntersections[0].y - M.y
    const cross0 = msX * tip0Y - msY * tip0X
    const tipPoint = cross0 <= 0 ? tipIntersections[0] : tipIntersections[1]
    const tipX = tipPoint.x - M.x
    const tipY = tipPoint.y - M.y
    const tipDist = Math.sqrt(tipX * tipX + tipY * tipY)
    tipDirX = tipX / tipDist
    tipDirY = tipY / tipDist
  } else {
    // Fallback: direction from M towards T
    const mtX = T.x - M.x
    const mtY = T.y - M.y
    const mtDist = Math.sqrt(mtX * mtX + mtY * mtY)
    tipDirX = mtX / mtDist
    tipDirY = mtY / mtDist
  }

  // Calculate source start: intersection of outer circle (M, radiusOuter) and source circle (S, sourceR)
  const sourceIntersections = circleCircleIntersection(M, radiusOuter, S, source.r)
  let sourceDirX: number, sourceDirY: number
  if (sourceIntersections) {
    // Pick intersection on the far side from tip (cross with tip direction <= 0)
    const src0X = sourceIntersections[0].x - M.x
    const src0Y = sourceIntersections[0].y - M.y
    const cross0 = tipDirX * src0Y - tipDirY * src0X
    const srcPoint = cross0 <= 0 ? sourceIntersections[0] : sourceIntersections[1]
    const srcX = srcPoint.x - M.x
    const srcY = srcPoint.y - M.y
    const srcDist = Math.sqrt(srcX * srcX + srcY * srcY)
    sourceDirX = srcX / srcDist
    sourceDirY = srcY / srcDist
  } else {
    // Fallback: direction from M to S
    sourceDirX = msDirX
    sourceDirY = msDirY
  }

  // Triangle extension factor: radiusOuter / cos(θ/2) where θ is arc angle
  const cosTheta = sourceDirX * tipDirX + sourceDirY * tipDirY
  const cosHalfTheta = Math.sqrt((1 + cosTheta) / 2)
  const extend = radiusOuter / cosHalfTheta

  // Triangle vertices
  const triangleV1: Vec2 = {
    x: M.x + sourceDirX * extend,
    y: M.y + sourceDirY * extend
  }
  const triangleV2: Vec2 = {
    x: M.x + tipDirX * extend,
    y: M.y + tipDirY * extend
  }

  return {
    arcCenter: M,
    centerRadius,
    normalizedHalfWidth,
    trunkLength,
    sourceDirX,
    sourceDirY,
    targetCenter: T,
    targetRadiusSq: target.r * target.r,
    triangleV1,
    triangleV2
  }
}

function createDegenerateGeometry(S: Vec2, T: Vec2, targetR: number): ArrowGeometry {
  return {
    arcCenter: S,
    centerRadius: 0.001,  // Avoid division by zero
    normalizedHalfWidth: 0,
    trunkLength: 1,
    sourceDirX: 1,
    sourceDirY: 0,
    targetCenter: T,
    targetRadiusSq: targetR * targetR,
    triangleV1: S,
    triangleV2: S
  }
}

/**
 * Calculate bounding box for the arrow
 */
export function calculateArrowBounds(geom: ArrowGeometry): { min: Vec2, max: Vec2 } {
  const M = geom.arcCenter
  const r = geom.centerRadius * (1 + geom.normalizedHalfWidth)

  return {
    min: { x: M.x - r, y: M.y - r },
    max: { x: M.x + r, y: M.y + r }
  }
}
