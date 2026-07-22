export interface RelaxableLink {
  parentId: string
  childId: string
  parentPosition: readonly [number, number]
  childPosition: readonly [number, number]
  parentRadius: number
  childRadius: number
  relativePosition: readonly [number, number]
}

export interface RelaxedConnection {
  parentId: string
  childId: string
  relativePosition: [number, number]
}

const TAU = Math.PI * 2

/**
 * Evenly spaces each parent's children while preserving their displayed
 * distance from the parent. The rotation which best matches the current
 * angular ordering is used, so relaxing causes the smallest useful change.
 */
export function proposeRelaxedConnections(
  links: readonly RelaxableLink[],
  minimumChange = 0.03
): RelaxedConnection[] {
  const byParent = new Map<string, RelaxableLink[]>()
  for (const link of links) {
    const group = byParent.get(link.parentId) ?? []
    group.push(link)
    byParent.set(link.parentId, group)
  }

  const proposals: RelaxedConnection[] = []
  for (const [parentId, siblings] of byParent) {
    if (siblings.length < 2) continue

    const ordered = siblings.map(link => {
      const dx = link.childPosition[0] - link.parentPosition[0]
      const dy = link.childPosition[1] - link.parentPosition[1]
      const radiusSum = Math.max(link.parentRadius + link.childRadius, 1e-6)
      return { link, angle: Math.atan2(dy, dx), magnitude: Math.hypot(dx, dy) / radiusSum }
    }).sort((a, b) => a.angle - b.angle)

    // Circular mean of each current angle with its even-spacing offset removed.
    let phaseX = 0
    let phaseY = 0
    ordered.forEach((item, index) => {
      const phase = item.angle - TAU * index / ordered.length
      phaseX += Math.cos(phase)
      phaseY += Math.sin(phase)
    })
    const phase = Math.atan2(phaseY, phaseX)

    ordered.forEach((item, index) => {
      const angle = phase + TAU * index / ordered.length
      const next: [number, number] = [
        Math.cos(angle) * item.magnitude,
        Math.sin(angle) * item.magnitude
      ]
      const previous = item.link.relativePosition
      if (Math.hypot(next[0] - previous[0], next[1] - previous[1]) <= minimumChange) return
      proposals.push({ parentId, childId: item.link.childId, relativePosition: next })
    })
  }
  return proposals
}
