// A project's graph as the Layout panel would get it: idea radii from the
// app's value sizing, connection strengths from the simulation's flow
// weights, semantic neighbours from the embeddings. Read only: nothing in the
// project is written (the backend would move a legacy cache database).
//
// Unlike the app, parentless ideas have no browser-stored position here: they
// are placed on a spiral, each subtree clear of the others.
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { calculateIdeaValues } from '../../packages/shared/src/value-calculation.ts'
import { IdeaSchema, ProjectMetaSchema, type Idea } from '../../packages/shared/src/types.ts'
import { INITIAL_STATES } from '../../packages/shared/src/constants.ts'
import { nodeRadius, normalizedFlowForceWeights } from '../../packages/frontend/src/utils/graph-forces.ts'
import { positionsFromStoredOffsets, type LayoutLink, type LayoutNode, type SemanticPair } from '../../packages/frontend/src/utils/autolayout.ts'

const NEAREST_NEIGHBOURS = 12 // as packages/backend/src/semantic-neighbours.ts
const OFFSET_JITTER = 0.02 // radius sums, below the solver's minimum change, so seeds differ only in chaos

export interface Snapshot {
  name: string
  nodes: LayoutNode[] // positions: where the stored offsets put each idea
  links: LayoutLink[]
  semanticPairs: SemanticPair[]
  // What the graph view draws besides positions, for the rating session.
  labels: { text: string; state: string }[] // per node
  attributionShares: number[] // per link: the share of the child's value that comes from the parent
  statuses: { key: string; color: string }[] // the project's status colors
}

export function loadSnapshot(name: string, projectPath: string, seed: number): Snapshot {
  const bowman = path.join(projectPath, '.bowman')
  const ideas = fs.readdirSync(path.join(bowman, 'ideas')).filter(file => file.endsWith('.json')).flatMap(file => {
    const parsed = IdeaSchema.safeParse(JSON.parse(fs.readFileSync(path.join(bowman, 'ideas', file), 'utf8')))
    return parsed.success ? [parsed.data as Idea] : []
  })
  const byId = new Map(ideas.map(idea => [idea.id, idea]))
  const { values, flowValues, attributionShares } = calculateIdeaValues(ideas)
  const averageValue = ideas.reduce((sum, idea) => sum + (values.get(idea.id) ?? 0), 0) / Math.max(ideas.length, 1)

  const random = mulberry32(seed)
  const jitter = () => seed === 0 ? 0 : (random() * 2 - 1) * OFFSET_JITTER
  const raw = ideas.flatMap(idea => (idea.supportingConnections ?? []).filter(connection => byId.has(connection.ideaId)).map(connection => ({
    parentId: idea.id,
    childId: connection.ideaId,
    relativePosition: [connection.relativePosition[0] + jitter(), connection.relativePosition[1] + jitter()] as [number, number],
    flowValue: flowValues.get(`${idea.id}->${connection.ideaId}`) ?? 0
  })))
  const strengths = normalizedFlowForceWeights(raw.map(link => ({ sourceId: link.childId, targetId: link.parentId, flowValue: link.flowValue })))
  const links: LayoutLink[] = raw.map(({ parentId, childId, relativePosition }, index) => ({ parentId, childId, relativePosition, editable: true, strength: strengths[index]! }))
  const unplaced: LayoutNode[] = ideas.map(idea => ({ id: idea.id, position: [0, 0], radius: nodeRadius(values.get(idea.id) ?? 0, averageValue), movable: true }))

  const meta = ProjectMetaSchema.partial().safeParse(JSON.parse(fs.readFileSync(path.join(bowman, 'meta.json'), 'utf8')))
  return {
    name,
    nodes: placeRoots(unplaced, links, random),
    links,
    semanticPairs: semanticNeighbours(bowman, new Set(byId.keys())),
    labels: ideas.map(idea => ({ text: idea.text, state: idea.status.state })),
    attributionShares: links.map(link => attributionShares.get(`${link.parentId}->${link.childId}`) ?? 0),
    statuses: ((meta.success ? meta.data.statuses : undefined) ?? INITIAL_STATES).map(({ key, color }) => ({ key, color }))
  }
}

// Each parentless idea with its subtree (as the stored offsets lay it out
// around it) goes to the first point of a sunflower spiral where it overlaps
// no subtree placed before; the largest first.
function placeRoots(nodes: LayoutNode[], links: LayoutLink[], random: () => number): LayoutNode[] {
  const atOrigin = positionsFromStoredOffsets(nodes, links)
  const hasParent = new Set(links.map(link => link.childId))
  const childrenOf = new Map<string, string[]>()
  for (const link of links) childrenOf.set(link.parentId, [...(childrenOf.get(link.parentId) ?? []), link.childId])
  const radiusOf = new Map(nodes.map(node => [node.id, node.radius]))
  const owner = new Map<string, string>()
  const roots = nodes.filter(node => !hasParent.has(node.id)).map(root => {
    const queue = [root.id]
    let extent = root.radius
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (owner.has(id)) continue
      owner.set(id, root.id)
      const [x, y] = atOrigin.get(id)!
      extent = Math.max(extent, Math.hypot(x, y) + radiusOf.get(id)!)
      queue.push(...(childrenOf.get(id) ?? []))
    }
    return { id: root.id, extent: extent * 1.1 }
  }).sort((left, right) => right.extent - left.extent)

  const step = Math.min(...roots.map(root => root.extent)) / 2
  const placed: { x: number; y: number; extent: number }[] = []
  const position = new Map<string, [number, number]>()
  const offset = random() * 2 * Math.PI
  let index = 0
  for (const root of roots) {
    for (;; index++) {
      const angle = index * 2.399963 + offset // golden angle
      const distance = step * Math.sqrt(index)
      const x = Math.cos(angle) * distance
      const y = Math.sin(angle) * distance
      if (placed.some(other => Math.hypot(other.x - x, other.y - y) < other.extent + root.extent)) continue
      placed.push({ x, y, extent: root.extent })
      position.set(root.id, [x, y])
      break
    }
  }
  const seeded = nodes.map(node => ({ ...node, position: position.get(node.id) ?? node.position }))
  const start = positionsFromStoredOffsets(seeded, links)
  return seeded.map(node => ({ ...node, position: start.get(node.id)! }))
}

function semanticNeighbours(bowman: string, ids: Set<string>): SemanticPair[] {
  const vectors = new Map<string, Float64Array>()
  for (const file of [path.join(bowman, 'cache', 'cache.db'), path.join(bowman, 'cache.db')]) {
    if (!fs.existsSync(file)) continue
    const db = new Database(file, { readonly: true, fileMustExist: true })
    try {
      for (const { id, vector } of db.prepare('SELECT id, vector FROM vectors').all() as { id: string; vector: Buffer }[]) {
        if (ids.has(id)) vectors.set(id, unit(new Float32Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength))))
      }
    } catch {
      // An older cache without the vectors table.
    } finally {
      db.close()
    }
    if (vectors.size > 0) break
  }
  const legacy = path.join(bowman, 'vectors.json')
  if (vectors.size === 0 && fs.existsSync(legacy)) {
    for (const [id, vector] of Object.entries(JSON.parse(fs.readFileSync(legacy, 'utf8')) as Record<string, number[]>)) {
      if (ids.has(id) && Array.isArray(vector)) vectors.set(id, unit(vector))
    }
  }

  const entries = [...vectors]
  const pairs: SemanticPair[] = []
  for (const [source, a] of entries) {
    const nearest: { target: string; distance: number }[] = []
    for (const [target, b] of entries) {
      if (target === source || b.length !== a.length) continue
      let dot = 0
      for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!
      nearest.push({ target, distance: 1 - dot })
    }
    nearest.sort((left, right) => left.distance - right.distance)
    for (const { target, distance } of nearest.slice(0, NEAREST_NEIGHBOURS)) pairs.push({ source, target, distance })
  }
  return pairs
}

function unit(vector: ArrayLike<number>) {
  let length = 0
  for (let i = 0; i < vector.length; i++) length += vector[i]! ** 2
  length = Math.sqrt(length) || 1
  return Float64Array.from(vector, value => value / length)
}

export function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
