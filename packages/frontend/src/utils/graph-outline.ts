// The wobbly string around a linked space opened in place: a closed curve
// around its ideas that moves gently, so what is external reads at a glance.
//
// The shape is radial around the centroid of the ideas: in each direction it
// reaches as far as the ideas' support in that direction (the furthest any
// idea's edge extends that way) plus a margin. That encloses every idea, as
// the convex hull would, and is smooth. The wobble only adds to the margin, so
// the string never cuts through an idea.

export type Circle = { x: number; y: number; r: number }
export type Outline = { cx: number; cy: number; radii: number[] }

const SAMPLES = 72
const WOBBLE = 0.35 // share of the margin the string moves in and out

export function graphOutline(circles: Circle[], margin: number, time = 0): Outline | null {
  if (circles.length === 0) return null
  const cx = circles.reduce((sum, c) => sum + c.x, 0) / circles.length
  const cy = circles.reduce((sum, c) => sum + c.y, 0) / circles.length
  const radii: number[] = []
  for (let i = 0; i < SAMPLES; i++) {
    const angle = (i / SAMPLES) * 2 * Math.PI
    const ux = Math.cos(angle)
    const uy = Math.sin(angle)
    let reach = 0
    for (const c of circles) reach = Math.max(reach, (c.x - cx) * ux + (c.y - cy) * uy + c.r)
    const wobble = Math.sin(3 * angle + time) * 0.6 + Math.sin(5 * angle - 1.3 * time) * 0.4
    radii.push(reach + margin * (1 + WOBBLE * wobble))
  }
  return { cx, cy, radii }
}

// The outline's distance from its centre in the direction of the angle.
function radiusAt(outline: Outline, angle: number): number {
  const n = outline.radii.length
  const at = (((angle / (2 * Math.PI)) * n) % n + n) % n
  const i = Math.floor(at)
  const t = at - i
  return outline.radii[i]! * (1 - t) + outline.radii[(i + 1) % n]! * t
}

export function outlineContains(outline: Outline, x: number, y: number): boolean {
  const dx = x - outline.cx
  const dy = y - outline.cy
  return Math.hypot(dx, dy) <= radiusAt(outline, Math.atan2(dy, dx))
}

/** A closed SVG path through the outline, smoothed (Catmull-Rom as cubic Béziers). */
export function outlinePath(outline: Outline): string {
  const n = outline.radii.length
  const points = outline.radii.map((r, i) => {
    const angle = (i / n) * 2 * Math.PI
    return [outline.cx + r * Math.cos(angle), outline.cy + r * Math.sin(angle)] as const
  })
  const p = (i: number) => points[(i + n) % n]!
  const f = (v: number) => v.toFixed(1)
  let d = `M${f(p(0)[0])},${f(p(0)[1])}`
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)]
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`
  }
  return `${d}Z`
}
