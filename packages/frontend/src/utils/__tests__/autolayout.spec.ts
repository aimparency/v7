import { describe, expect, it } from 'vitest'
import { createLayoutSolver, roundOffset, solveLayout, type LayoutLink, type LayoutNode } from '../autolayout'
import { measureLayout } from '../layout-metrics'

const R = 10 // every idea has this radius, so one radius sum is 20

// Positions that satisfy every stored offset exactly, laid out from the root.
function graph(offsets: Record<string, [string, [number, number]][]>) {
  const position = new Map<string, [number, number]>([['root', [0, 0]]])
  const links: LayoutLink[] = []
  const place = (parentId: string) => {
    for (const [childId, relativePosition] of offsets[parentId] ?? []) {
      links.push({ parentId, childId, relativePosition, editable: true, width: 10 })
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
  return list.some((a, i) => list.slice(i + 1).some(b => Math.hypot(a[0] - b[0], a[1] - b[1]) < 2 * R * 2.6)) // default clearance 3, a soft constraint: ends within about 10% of it, far above the simulation's 2
}

describe('solveLayout', () => {
  it('changes nothing when the stored offsets already form a clean layout', () => {
    const { nodes, links } = graph({ root: [['a', [4, 0]], ['b', [-4, 0]]], a: [['c', [4, 0]]] })
    expect(solveLayout(nodes, links).changes).toEqual([])
  })

  it('keeps the spacing the simulation keeps, so it comes to rest', () => {
    const { nodes, links } = graph({ root: [['a', [2.5, 0]], ['b', [2.5, 0.3]], ['c', [2.4, -0.4]], ['d', [-2.5, 0]]] })
    expect(crowded(solveLayout(nodes, links).positions)).toBe(false)
  })

  it('moves a crowded subtree rigidly: only the connection into its root is rewritten', () => {
    const { nodes, links } = graph({
      root: [['a', [5, 0]], ['b', [5, 0.3]], ['c', [-5, 0]]],
      a: [['a1', [5, 0]]],
      b: [['b1', [5, 0.5]]]
    })
    // Connections at the minimum distance and their pull off (they would share
    // the circle around the root evenly): only the crowding moves anything.
    const { positions, changes } = solveLayout(nodes, links, { weights: { length: 0 } })
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

  it('spreads a crowded fan of connections around its idea', () => {
    const fan = (degrees: number) => [Math.cos(degrees * Math.PI / 180) * 3.75, Math.sin(degrees * Math.PI / 180) * 3.75] as [number, number]
    const { nodes, links } = graph({ root: [['a', fan(0)], ['b', fan(15)], ['c', fan(30)], ['d', fan(45)]] })
    const { positions } = solveLayout(nodes, links)
    const [rootX, rootY] = positions.get('root')!
    const angles = ['a', 'b', 'c', 'd'].map(id => Math.atan2(positions.get(id)![1] - rootY, positions.get(id)![0] - rootX)).sort((left, right) => left - right)
    const gaps = angles.map((angle, index) => (angles[(index + 1) % angles.length]! - angle + 2 * Math.PI) % (2 * Math.PI))
    expect(Math.min(...gaps)).toBeGreaterThan(0.55 * (1.5 * Math.PI / 4)) // balanced against keeping the stored 15° (ideal: 90°)
  })

  it('makes room: a branch drawn to one side turns its neighbour on', () => {
    const at = (degrees: number) => [Math.cos(degrees * Math.PI / 180) * 3.75, Math.sin(degrees * Math.PI / 180) * 3.75] as [number, number]
    const { nodes: free, links } = graph({ root: [['a', at(0)], ['b', at(90)], ['c', at(180)], ['d', at(270)]] })
    // The root held, or the whole tree would just slide over to the fixed similar idea.
    const nodes = free.map(node => ({ ...node, movable: node.id !== 'root' }))
    const anchor: LayoutNode = { id: 'anchor', position: [Math.cos(1.4) * 300, Math.sin(1.4) * 300], radius: R, movable: false }
    const angle = (positions: Map<string, [number, number]>, id: string) =>
      (Math.atan2(positions.get(id)![1] - positions.get('root')![1], positions.get(id)![0] - positions.get('root')![0]) + 2 * Math.PI) % (2 * Math.PI)
    const { positions } = solveLayout([...nodes, anchor], links, { semanticPairs: [{ source: 'a', target: 'anchor', distance: 0 }], weights: { semantic: 2 } })
    // Its share of the circle holds it back; the shares turn along a little.
    expect(angle(positions, 'a')).toBeGreaterThan(0.3)
    expect(angle(positions, 'b')).toBeGreaterThan(Math.PI / 2 + 0.03)
  })

  it('reports offsets that agree with the positions, also around a cycle', () => {
    // An equilateral triangle one radius sum wide: the space push has to move all three.
    const nodes: LayoutNode[] = [
      { id: 'a', position: [0, 0], radius: R, movable: true },
      { id: 'b', position: [2 * R, 0], radius: R, movable: true },
      { id: 'c', position: [R, 1.74 * R], radius: R, movable: true }
    ]
    const link = (parentId: string, childId: string, relativePosition: [number, number]): LayoutLink => ({ parentId, childId, relativePosition, editable: true, width: 10 })
    const links = [link('a', 'b', [1, 0]), link('b', 'c', [-0.5, 0.87]), link('c', 'a', [-0.5, -0.87])]
    const { positions, changes } = solveLayout(nodes, links)
    expect(changes.length).toBeGreaterThan(0)
    for (const { parentId, childId, relativePosition } of changes) {
      const [px, py] = positions.get(parentId)!
      const [cx, cy] = positions.get(childId)!
      expect(Math.hypot(px + relativePosition[0] * 2 * R - cx, py + relativePosition[1] * 2 * R - cy)).toBeLessThan(0.1)
    }
  })

  it('lets a branch pulled across pass its neighbour', () => {
    const at = (degrees: number) => [Math.cos(degrees * Math.PI / 180) * 4, Math.sin(degrees * Math.PI / 180) * 4] as [number, number]
    const { nodes: free, links } = graph({ root: [['a', at(0)], ['b', at(120)], ['c', at(240)]] })
    const nodes = free.map(node => ({ ...node, movable: node.id !== 'root' })) // held, as above
    // Something similar to `a` lies beyond `b`.
    const anchor: LayoutNode = { id: 'anchor', position: [Math.cos(2.6) * 300, Math.sin(2.6) * 300], radius: R, movable: false }
    const angle = (positions: Map<string, [number, number]>, id: string) =>
      (Math.atan2(positions.get(id)![1] - positions.get('root')![1], positions.get(id)![0] - positions.get('root')![0]) + 2 * Math.PI) % (2 * Math.PI)
    // A minimum space wider than the siblings' distance blocks the pass (space
    // 5 here), so this tests the connections' order alone.
    const solver = createLayoutSolver([...nodes, anchor], links, { semanticPairs: [{ source: 'a', target: 'anchor', distance: 0 }], weights: { semantic: 2, space: 3 } })
    for (let iteration = 0; iteration < 300; iteration++) solver.step()
    expect(angle(solver.positions(), 'a')).toBeGreaterThan(angle(solver.positions(), 'b'))
  })

  it('puts an idea amid its connections instead of beside them', () => {
    // Children all to one side: the root moves into their middle and they
    // share the circle around it, keeping their order.
    const at = (degrees: number) => [Math.cos(degrees * Math.PI / 180) * 4, Math.sin(degrees * Math.PI / 180) * 4] as [number, number]
    const { nodes, links } = graph({ root: [['a', at(0)], ['b', at(20)], ['c', at(40)]] })
    const { positions } = solveLayout(nodes, links, { weights: { memory: 0.001 } })
    const [rootX, rootY] = positions.get('root')!
    const angles = ['a', 'b', 'c'].map(id => Math.atan2(positions.get(id)![1] - rootY, positions.get(id)![0] - rootX))
    const pull = [Math.cos, Math.sin].map(part => angles.reduce((sum, angle) => sum + part(angle), 0))
    expect(Math.hypot(pull[0]!, pull[1]!)).toBeLessThan(0.3) // three equal shares: 0; all to one side: 3
    expect((angles[1]! - angles[0]! + 2 * Math.PI) % (2 * Math.PI)).toBeLessThan(Math.PI) // a, b, c still counter-clockwise
  })

  it('settles a connection between its target gap and the minimum distance', () => {
    const { nodes, links } = graph({ root: [['a', [3, 0]]] })
    const { positions } = solveLayout(nodes, links, { room: 3, weights: { memory: 0.001, space: 5 } })
    const length = Math.hypot(positions.get('a')![0] - positions.get('root')![0], positions.get('a')![1] - positions.get('root')![1]) / (2 * R)
    expect(length).toBeGreaterThan(3.2)
    expect(length).toBeLessThan(4.8)
  })

  it('gives a wider connection a wider share of the circle', () => {
    const at = (degrees: number) => [Math.cos(degrees * Math.PI / 180) * 4, Math.sin(degrees * Math.PI / 180) * 4] as [number, number]
    const { nodes, links } = graph({ root: [['wide', at(0)], ['left', at(120)], ['right', at(240)]] })
    const widened = links.map(link => link.childId === 'wide' ? { ...link, width: 20 } : link)
    const { positions } = solveLayout(nodes, widened, { weights: { memory: 0.001, space: 3 } })
    const angle = (id: string) => Math.atan2(positions.get(id)![1] - positions.get('root')![1], positions.get(id)![0] - positions.get('root')![0])
    const between = (from: string, to: string) => Math.abs(((angle(to) - angle(from) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)
    // Shares of 180°, 90° and 90°: the thin ones 90° apart, 135° from the wide one.
    expect(between('left', 'right')).toBeLessThan(between('wide', 'left') - 0.3)
  })

  it('lists the most relevant changes first: big ideas outrank equally misplaced small ones', () => {
    const node = (id: string, x: number, radius: number): LayoutNode => ({ id, position: [x, 0], radius, movable: true })
    const nodes = [node('root', 0, R), node('small', -12 * 2 * R, R), node('big', 12 * 4 * R, 3 * R)]
    const links: LayoutLink[] = [
      { parentId: 'root', childId: 'small', relativePosition: [-12, 0], editable: true, width: 10 },
      { parentId: 'root', childId: 'big', relativePosition: [12, 0], editable: true, width: 10 }
    ]
    const { changes } = solveLayout(nodes, links)
    expect(changes.map(change => change.childId)).toEqual(['big', 'small'])
  })

  it('draws similar ideas of separate groups together, the heavier group moving less', () => {
    const { nodes, links } = graph({ root: [['a', [3.75, 0]], ['b', [-3.75, 0]]], a: [['a1', [3.75, 0]]], b: [['b1', [-3.75, 0]]] })
    const loner: LayoutNode = { id: 'loner', position: [0, 40 * 2 * R], radius: R, movable: true }
    const { positions } = solveLayout([...nodes, loner], links, {
      semanticPairs: [{ source: 'loner', target: 'a1', distance: 0.1 }, { source: 'loner', target: 'a', distance: 0.2 }]
    })
    const distance = (from: string, to: string) => Math.hypot(positions.get(from)![0] - positions.get(to)![0], positions.get(from)![1] - positions.get(to)![1]) / (2 * R)
    const moved = (node: LayoutNode) => Math.hypot(positions.get(node.id)![0] - node.position[0], positions.get(node.id)![1] - node.position[1])
    expect(distance('loner', 'a1')).toBeLessThan(6.1) // pulled to the minimum distance × (1 + 2 · 0.1), not inside it
    expect(moved(nodes.find(node => node.id === 'root')!)).toBeLessThan(moved(loner) / 2)
    const all = [...nodes, loner]
    const centre = (at: (node: LayoutNode) => readonly [number, number], axis: 0 | 1) => all.reduce((sum, node) => sum + at(node)[axis], 0) / all.length
    expect(Math.hypot(centre(node => positions.get(node.id)!, 0) - centre(node => node.position, 0), centre(node => positions.get(node.id)!, 1) - centre(node => node.position, 1)) / (2 * R)).toBeLessThan(0.5)
  })

  it('puts an idea nearer its most similar neighbour, not midway', () => {
    const { nodes, links } = graph({ root: [['left', [-6, 0]], ['right', [6, 0]]] })
    const loner: LayoutNode = { id: 'loner', position: [0, 30 * 2 * R], radius: R, movable: true }
    const { positions } = solveLayout([...nodes, loner], links, {
      semanticPairs: [{ source: 'loner', target: 'left', distance: 0.1 }, { source: 'loner', target: 'right', distance: 0.4 }]
    })
    const distance = (to: string) => Math.hypot(positions.get('loner')![0] - positions.get(to)![0], positions.get('loner')![1] - positions.get(to)![1])
    expect(distance('left')).toBeLessThan(0.7 * distance('right')) // midway: 1
  })

  it('reports the result so far while it solves', () => {
    const { nodes, links } = graph({ root: [['far', [12, 0]], ['near', [-3, 0]]] })
    const progress: number[] = []
    const { changes } = solveLayout(nodes, links, { iterations: 30, progressEvery: 10, onProgress: ({ changes }) => progress.push(changes[0]!.shift) })
    expect(progress).toHaveLength(2)
    expect(progress[1]).toBeGreaterThan(progress[0]!)
    expect(changes[0]!.shift).toBeGreaterThanOrEqual(progress[1]!)
  })

  it('comes to rest: crowded ideas stop moving instead of being pushed back and forth', () => {
    const { nodes, links } = graph({ root: [['a', [2, 0]], ['b', [2, 0.5]], ['c', [1.5, -1]], ['d', [-2, 0]]], a: [['a1', [1, 0]], ['a2', [1, 0.4]]], b: [['b1', [0.5, 1]]] })
    const solver = createLayoutSolver(nodes, links)
    let largestMove = Infinity
    for (let iteration = 0; iteration < 300; iteration++) largestMove = solver.step()
    expect(largestMove).toBeLessThan(0.01)
  })

  it('keeps the centre of the network in place while the solver keeps running', () => {
    // A tree that grows to one side: its connections turn toward even shares.
    const { nodes, links } = graph({ root: [['a', [2, 1]], ['b', [1, 2]]], a: [['a1', [2, 1]], ['a2', [1.5, 1.5]]], b: [['b1', [1, 2]], ['b2', [1.5, 1.5]]] })
    const solver = createLayoutSolver(nodes, links)
    for (let iteration = 0; iteration < 900; iteration++) solver.step()
    const centre = (positions: Map<string, readonly [number, number]>) =>
      [0, 1].map(axis => [...positions.values()].reduce((sum, position) => sum + position[axis]!, 0) / positions.size)
    const start = centre(new Map(nodes.map(node => [node.id, node.position])))
    const end = centre(solver.positions())
    expect(Math.hypot(end[0]! - start[0]!, end[1]! - start[1]!)).toBeLessThan(0.01)
  })

  it('never rewrites connections that are not editable', () => {
    const { nodes, links } = graph({ root: [['a', [3, 0]], ['b', [3, 0]]] })
    const locked = links.map(link => ({ ...link, editable: false }))
    const { positions, changes } = solveLayout(nodes, locked)
    expect(changes).toEqual([])
    expect(crowded(positions)).toBe(false)
  })


  it('rounds offsets so unchanged layouts re-save without float noise', () => {
    expect(roundOffset([0.5782261044010013, -2.432211868277359])).toEqual([0.58, -2.43])
  })
})
