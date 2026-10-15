import { describe, expect, it } from 'vitest'
import { roundOffset, solveDiffMinimalLayout, type LayoutLink, type LayoutNode } from '../autolayout'

const R = 10 // every idea has this radius, so one radius sum is 20

// Positions that satisfy every stored offset exactly, laid out from the root.
function graph(offsets: Record<string, [string, [number, number]][]>, overrides: Record<string, [number, number]> = {}) {
  const position = new Map<string, [number, number]>([['root', [0, 0]]])
  const links: LayoutLink[] = []
  const place = (parentId: string) => {
    for (const [childId, relativePosition] of offsets[parentId] ?? []) {
      links.push({ parentId, childId, relativePosition, editable: true })
      if (position.has(childId)) continue
      const [px, py] = position.get(parentId)!
      position.set(childId, [px + relativePosition[0] * 2 * R, py + relativePosition[1] * 2 * R])
      place(childId)
    }
  }
  place('root')
  const nodes: LayoutNode[] = [...position].map(([id, at]) => ({ id, position: overrides[id] ?? at, radius: R, movable: true }))
  return { nodes, links }
}

const overlaps = (positions: Map<string, [number, number]>) => {
  const list = [...positions.values()]
  return list.some((a, i) => list.slice(i + 1).some(b => Math.hypot(a[0] - b[0], a[1] - b[1]) < 2 * R * 1.19)) // default clearance 1.2
}

describe('solveDiffMinimalLayout', () => {
  it('changes nothing when the stored offsets already form a clean layout', () => {
    const { nodes, links } = graph({ root: [['a', [3, 0]], ['b', [-3, 0]]], a: [['c', [0, 3]]] })
    expect(solveDiffMinimalLayout(nodes, links).changes).toEqual([])
  })

  it('moves an overlapping subtree rigidly: only the connection into its root is rewritten', () => {
    // b sits on top of a; a and b both carry children.
    const { nodes, links } = graph({
      root: [['a', [3, 0]], ['b', [3, 0.2]], ['c', [-3, 0]]],
      a: [['a1', [0, -3]]],
      b: [['b1', [0, 3]], ['b2', [2.5, 2.5]]]
    })
    const { positions, changes } = solveDiffMinimalLayout(nodes, links)

    expect(overlaps(positions)).toBe(false)
    expect(changes.length).toBeGreaterThan(0)
    expect(changes.every(change => change.parentId === 'root' && ['a', 'b'].includes(change.childId))).toBe(true)
  })

  it('resolves a child whose two parents disagree by rewriting a single connection', () => {
    // shared is placed by a; b's stored offset points elsewhere.
    const { nodes, links } = graph({
      root: [['a', [3, 0]], ['b', [-3, 0]]],
      a: [['shared', [-1.5, 3]]],
      b: [['shared', [0.5, 3.5]]]
    })
    const { changes } = solveDiffMinimalLayout(nodes, links)
    expect(changes).toHaveLength(1)
  })

  it('never rewrites connections that are not editable', () => {
    const { nodes, links } = graph({ root: [['a', [3, 0]], ['b', [3, 0]]] })
    const locked = links.map(link => ({ ...link, editable: false }))
    const { positions, changes } = solveDiffMinimalLayout(nodes, locked)
    expect(changes).toEqual([])
    expect(overlaps(positions)).toBe(false)
  })

  it('rounds offsets so unchanged layouts re-save without float noise', () => {
    expect(roundOffset([0.5782261044010013, -2.432211868277359])).toEqual([0.58, -2.43])
  })
})
