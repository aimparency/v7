import type * as vec2 from './vec2'

// The layout of a space opened in place, kept in the browser per parent space
// path: each idea's position relative to the ideas' centre of mass, so the
// space opens again as it was, wherever its node is now.

type Layout = Record<string, [number, number]>
const key = (parentPath: string, repoId: string) => `aimparency-subspace-layout:${parentPath}:${repoId}`

export function loadSubspaceLayout(parentPath: string, repoId: string): Layout {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(parentPath, repoId)) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' ? parsed as Layout : {}
  } catch {
    return {}
  }
}

export function saveSubspaceLayout(parentPath: string, repoId: string, members: readonly { id: string, pos: vec2.T }[]) {
  if (members.length === 0) return
  const [cx, cy] = centreOf(members.map(member => member.pos))
  const layout: Layout = Object.fromEntries(members.map(({ id, pos }) => [id, [pos[0] - cx, pos[1] - cy]]))
  try {
    localStorage.setItem(key(parentPath, repoId), JSON.stringify(layout))
  } catch {
    // Storage full or blocked: the space opens around its node as new.
  }
}

/** The unweighted mean, as the graph's own mass point (positionCentroid). */
export function centreOf(points: readonly vec2.T[]): vec2.T {
  let x = 0
  let y = 0
  for (const [px, py] of points) {
    x += px
    y += py
  }
  return [x / points.length, y / points.length]
}

/**
 * Positions for ideas appearing around `centre`: as stored where known, near
 * the centre otherwise, shifted so their centre of mass is `centre` exactly.
 */
export function placeAround(centre: vec2.T, ids: readonly string[], stored: Layout, jitter = 100): Map<string, vec2.T> {
  if (ids.length === 0) return new Map()
  const offsets = ids.map((id): vec2.T => stored[id] ? [stored[id][0], stored[id][1]] : [Math.random() * jitter - jitter / 2, Math.random() * jitter - jitter / 2])
  const [mx, my] = centreOf(offsets)
  return new Map(ids.map((id, index) => [id, [centre[0] + offsets[index]![0] - mx, centre[1] + offsets[index]![1] - my]]))
}
