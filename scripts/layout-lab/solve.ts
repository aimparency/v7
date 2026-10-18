// What the runner and the rating session share: the configured projects and
// one autolayout run on a snapshot, with the schedule the app's worker uses.
import fs from 'node:fs'
import path from 'node:path'
import type { LayoutSettings } from '../../packages/shared/src/types.ts'
import { createLayoutSolver, createRelaxation, DEFAULT_LAYOUT_SETTINGS, layoutOptions, positionsFromStoredOffsets, type LayoutChange, type LayoutOptions, type LayoutPlacement } from '../../packages/frontend/src/utils/autolayout.ts'
import type { Snapshot } from './snapshot.ts'

export interface Run {
  settings?: Partial<LayoutSettings> // what the panel tunes
  weights?: LayoutOptions['weights'] // also the mechanics (anchor, separation)
  options?: Omit<LayoutOptions, 'room' | 'weights' | 'semanticPairs'>
  relax?: Parameters<typeof createRelaxation>[1]
  // Connection strengths other than the simulation's (0.25–0.75, square-root
  // compressed): 'flow' uncompressed (0–1), 'child-share' the share of the
  // child's value that comes through the connection (a small idea's only
  // connection counts fully).
  strengths?: 'flow' | 'child-share'
}

const strengthOf = {
  flow: (simulation: number) => ((simulation - 0.25) / 0.5) ** 2, // undoes graph-forces' compression
  'child-share': (_: number, attributionShare: number) => attributionShare
}

// Projects come from projects.local.json ({ "name": "/path/to/project" },
// machine specific, not checked in).
export function loadProjects(filter: string[] = []): [string, string][] {
  const file = path.join(import.meta.dirname, 'projects.local.json')
  if (!fs.existsSync(file)) {
    console.error(`missing ${file}; copy projects.example.json and point it at your projects`)
    process.exit(1)
  }
  return Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>)
    .filter(([name]) => filter.length === 0 || filter.includes(name))
}

export function solve(snapshot: Snapshot, run: Run) {
  const { nodes, semanticPairs } = snapshot
  const strength = run.strengths && strengthOf[run.strengths]
  const links = strength ? snapshot.links.map((link, index) => ({ ...link, strength: strength(link.strength, snapshot.attributionShares[index]!) })) : snapshot.links
  const settings: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, ...run.settings }
  const started = Date.now()
  const options = layoutOptions(settings)
  const solver = createLayoutSolver(nodes, links, { ...options, ...run.options, weights: { ...options.weights, ...run.weights }, semanticPairs })
  const relaxation = createRelaxation(solver, run.relax)
  let chunk = relaxation.chunk()
  while (!chunk.done) chunk = relaxation.chunk()
  const { changes, placements } = solver.result()
  return {
    settings,
    changes,
    placements,
    positions: applied(snapshot, changes, placements),
    iterations: relaxation.iterations(),
    lastMove: chunk.largestMove,
    milliseconds: Date.now() - started
  }
}

// Where the stored offsets put each idea once these changes are saved: what
// the panel shows, and what the simulation settles toward after Apply.
export function applied({ nodes, links }: Snapshot, changes: readonly LayoutChange[], placements: readonly LayoutPlacement[]) {
  const offset = new Map(changes.map(change => [`${change.parentId}>${change.childId}`, change.relativePosition]))
  const placement = new Map(placements.map(({ id, position }) => [id, position]))
  return positionsFromStoredOffsets(
    nodes.map(node => ({ ...node, position: placement.get(node.id) ?? node.position })),
    links.map(link => ({ ...link, relativePosition: offset.get(`${link.parentId}>${link.childId}`) ?? link.relativePosition }))
  )
}
