import { describe, expect, it } from 'vitest'
import { positionsFromStoredOffsets, roundOffset, solveLayout, type LayoutLink, type LayoutNode } from '../autolayout'
import { measureLayout } from '../layout-metrics'

const R = 10 // every idea has this radius, so one radius sum is 20

// Positions that satisfy every stored offset exactly, laid out from the root.
function graph(offsets: Record<string, [string, [number, number]][]>) {
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
  const nodes: LayoutNode[] = [...position].map(([id, at]) => ({ id, position: at, radius: R, movable: true }))
  return { nodes, links }
}

const crowded = (positions: Map<string, [number, number]>) => {
  const list = [...positions.values()]
  return list.some((a, i) => list.slice(i + 1).some(b => Math.hypot(a[0] - b[0], a[1] - b[1]) < 2 * R * 1.99)) // default clearance 2
}

describe('solveLayout', () => {
  it('changes nothing when the stored offsets already form a clean layout', () => {
    const { nodes, links } = graph({ root: [['a', [3, 0]], ['b', [-3, 0]]], a: [['c', [0, 3]]] })
    expect(solveLayout(nodes, links).changes).toEqual([])
  })

  it('keeps the spacing the simulation keeps, so it comes to rest', () => {
    const { nodes, links } = graph({ root: [['a', [2.5, 0]], ['b', [2.5, 0.3]], ['c', [2.4, -0.4]], ['d', [-2.5, 0]]] })
    expect(crowded(solveLayout(nodes, links).positions)).toBe(false)
  })

  it('moves a crowded subtree rigidly: only the connection into its root is rewritten', () => {
    const { nodes, links } = graph({
      root: [['a', [3, 0]], ['b', [3, 0.2]], ['c', [-3, 0]]],
      a: [['a1', [3, 0]]],
      b: [['b1', [3, 0.5]]]
    })
    const { positions, changes } = solveLayout(nodes, links)
    expect(crowded(positions)).toBe(false)
    expect(changes.map(change => `${change.parentId}>${change.childId}`).every(id => ['root>a', 'root>b'].includes(id))).toBe(true)
  })

  it('resolves a child whose two parents disagree: afterwards both offsets put it in one place', () => {
    const { nodes, links } = graph({
      root: [['a', [3, 0]], ['b', [-3, 0]]],
      a: [['shared', [-1.5, 3]]],
      b: [['shared', [0.5, 3.5]]]
    })
    const { positions, changes } = solveLayout(nodes, links)
    const offset = (parentId: string) => changes.find(change => change.parentId === parentId && change.childId === 'shared')?.relativePosition
      ?? links.find(link => link.parentId === parentId && link.childId === 'shared')!.relativePosition
    const via = (parentId: string) => [0, 1].map(axis => positions.get(parentId)![axis]! + offset(parentId)[axis]! * 2 * R)
    expect(via('a')[0]).toBeCloseTo(via('b')[0]!, -1)
    expect(via('a')[1]).toBeCloseTo(via('b')[1]!, -1)
  })

  it('shortens a long connection and lists the largest shifts first', () => {
    const { nodes, links } = graph({ root: [['far', [12, 0]], ['near', [-3, 0]], ['close', [0, 3]]], close: [['other', [0, 3.2]]] })
    const { positions, changes } = solveLayout(nodes, links)
    expect(changes[0]).toMatchObject({ parentId: 'root', childId: 'far' })
    expect(Math.hypot(...changes[0]!.relativePosition)).toBeLessThan(7)
    expect(changes.map(change => change.shift)).toEqual(changes.map(change => change.shift).sort((left, right) => right - left))
    expect(measureLayout(nodes, links, positions).meanLength).toBeLessThan(measureLayout(nodes, links).meanLength)
  })

  it('draws semantically close ideas of different branches toward each other', () => {
    const { nodes, links } = graph({ root: [['left', [-3, 0]], ['right', [3, 0]]], left: [['l1', [-3, 1]]], right: [['r1', [3, -1]]] })
    const distance = (positions: Map<string, [number, number]>) =>
      Math.hypot(positions.get('l1')![0] - positions.get('r1')![0], positions.get('l1')![1] - positions.get('r1')![1])
    const plain = solveLayout(nodes, links).positions
    const semantic = solveLayout(nodes, links, { semanticPairs: [{ source: 'l1', target: 'r1', distance: 0.1 }], weights: { semantic: 0.5 } }).positions
    expect(distance(semantic)).toBeLessThan(distance(plain))
  })

  it('never rewrites connections that are not editable', () => {
    const { nodes, links } = graph({ root: [['a', [3, 0]], ['b', [3, 0]]] })
    const locked = links.map(link => ({ ...link, editable: false }))
    const { positions, changes } = solveLayout(nodes, locked)
    expect(changes).toEqual([])
    expect(crowded(positions)).toBe(false)
  })

  it('places ideas where their stored offsets put them', () => {
    const { nodes, links } = graph({ root: [['a', [3, 0]]], a: [['b', [0, 2]]] })
    const moved: LayoutNode[] = nodes.map(node => node.id === 'root' ? node : { ...node, position: [99, 99] })
    expect(positionsFromStoredOffsets(moved, links).get('b')).toEqual([60, 40])
  })

  it('rounds offsets so unchanged layouts re-save without float noise', () => {
    expect(roundOffset([0.5782261044010013, -2.432211868277359])).toEqual([0.58, -2.43])
  })
})

describe('measureLayout', () => {
  it('counts crossings between unrelated connections, crowding and long connections', () => {
    const node = (id: string, x: number, y: number) => ({ id, position: [x, y] as const, radius: R })
    const nodes = [node('a', 0, 0), node('b', 200, 200), node('c', 0, 200), node('d', 200, 0), node('e', 30, 0)]
    const metrics = measureLayout(nodes, [{ parentId: 'a', childId: 'b' }, { parentId: 'c', childId: 'd' }])
    expect(metrics.crossings).toBe(1)
    expect(metrics.longConnections).toBe(2)
    expect(metrics.crowdedPairs).toBe(1) // a and e: 1.5 radius sums
    expect(metrics.overlaps).toBe(0)
  })
})
