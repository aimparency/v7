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

  // Precompute trunk length: head takes ~2x the normalized width
  const headLength = Math.min(2.0 * normalizedHalfWidth, 0.5)  // Cap at 50% of arc
  const trunkLength = 1.0 - headLength

  // For triangle extension, compute outer radius
  const radiusOuter = centerRadius + halfWidth

  // Calculate tip point (tangent point from M to T's circle)
  // The line M→tip is tangent to T's circle at tip
  // This means (tip - M) · (tip - T) = 0
  const mtX = T.x - M.x
  const mtY = T.y - M.y
  const d = Math.sqrt(mtX * mtX + mtY * mtY)

  // Angle from T towards M
  const angleToM = Math.atan2(M.y - T.y, M.x - T.x)

  // Angle offset to tangent point: cos(θ) = r/d
  // If M is inside T's circle, no tangent exists - use fallback
  let tipPoint: Vec2
  if (d <= target.r) {
    // Fallback: use closest point on circle
    tipPoint = {
      x: T.x - (mtX / d) * target.r,
      y: T.y - (mtY / d) * target.r
    }
  } else {
    const tangentAngleOffset = Math.acos(target.r / d)
    // Choose tangent point closer to the supporting aim (S)
    const tipAngle = angleToM - tangentAngleOffset
    tipPoint = {
      x: T.x + target.r * Math.cos(tipAngle),
      y: T.y + target.r * Math.sin(tipAngle)
    }
  }

  // Triangle vertices per spec:
  // V0 = M (arc center)
  // V1 = Extended along M→S direction (covers start of arc)
  // V2 = Extended along M→tip direction (the tip, covers end of arc)

  const triangleV0: Vec2 = M  // Arc center

  // Calculate directions
  const msDirX = msX / centerRadius  // msX, msY already calculated, centerRadius = |M→S|
  const msDirY = msY / centerRadius

  const mtipX = tipPoint.x - M.x
  const mtipY = tipPoint.y - M.y
  const mtipDist = Math.sqrt(mtipX * mtipX + mtipY * mtipY)
  const mtipDirX = mtipX / mtipDist
  const mtipDirY = mtipY / mtipDist

  // Calculate exact extension factor: radiusOuter / cos(θ/2)
  // where θ is the arc angle between M→S and M→tip
  // cos(θ) = dot(msDir, mtipDir)
  const cosTheta = msDirX * mtipDirX + msDirY * mtipDirY
  // cos(θ/2) = sqrt((1 + cos(θ)) / 2)
  const cosHalfTheta = Math.sqrt((1 + cosTheta) / 2)
  const extend = radiusOuter / cosHalfTheta

  // V1: Extend along M→S direction
  const triangleV1: Vec2 = {
    x: M.x + msDirX * extend,
    y: M.y + msDirY * extend
  }

  // V2: Extend along M→tip direction
  const triangleV2: Vec2 = {
    x: M.x + mtipDirX * extend,
    y: M.y + mtipDirY * extend
  }

  return {
    arcCenter: M,
    centerRadius,
    normalizedHalfWidth,
    trunkLength,
    sourceDirX: msDirX,  // Already normalized (msX / centerRadius)
    sourceDirY: msDirY,
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
