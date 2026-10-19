// What the runner and the rating session share: the configured projects and
// one autolayout run on a snapshot, with the schedule the app's worker uses.
import fs from 'node:fs'
import path from 'node:path'
import type { LayoutSettings } from '../../packages/shared/src/types.ts'
import { createLayoutSolver, createRelaxation, DEFAULT_LAYOUT_SETTINGS, layoutOptions, type LayoutOptions } from '../../packages/frontend/src/utils/autolayout.ts'
import type { Snapshot } from './snapshot.ts'

export interface Run {
  settings?: Partial<LayoutSettings> // what the panel tunes
  weights?: LayoutOptions['weights']
  options?: Omit<LayoutOptions, 'room' | 'weights' | 'semanticPairs'>
  relax?: Parameters<typeof createRelaxation>[1]
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
  const { nodes, links, semanticPairs } = snapshot
  const settings: Required<LayoutSettings> = { ...DEFAULT_LAYOUT_SETTINGS, ...run.settings }
  const started = Date.now()
  const options = layoutOptions(settings)
  const solver = createLayoutSolver(nodes, links, { ...options, ...run.options, weights: { ...options.weights, ...run.weights }, semanticPairs })
  const relaxation = createRelaxation(solver, run.relax)
  let chunk = relaxation.chunk()
  while (!chunk.done) chunk = relaxation.chunk()
  const { changes } = solver.result()
  return {
    settings,
    changes,
    positions: solver.positions(),
    iterations: relaxation.iterations(),
    lastMove: chunk.largestMove,
    milliseconds: Date.now() - started
  }
}
