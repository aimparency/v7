// Layout lab: runs the autolayout on real projects under different settings
// and measures the results.
//
//   pnpm layout-lab <experiment> [project...]
//
// <experiment> names a module in experiments/ (see Experiment below).
// Projects come from projects.local.json ({ "name": "/path/to/project" },
// machine specific, not checked in). Writes results/<experiment>.jsonl and
// the report results/<experiment>.html.
import fs from 'node:fs'
import path from 'node:path'
import type { LayoutSettings } from '../../packages/shared/src/types.ts'
import { DEFAULT_LAYOUT_SETTINGS } from '../../packages/frontend/src/utils/autolayout.ts'
import { measureLayout, type LayoutMetrics } from '../../packages/frontend/src/utils/layout-metrics.ts'
import { loadSnapshot, type Snapshot } from './snapshot.ts'
import { writeReport } from './report.ts'
import { applied, loadProjects, solve, type Run } from './solve.ts'

export interface Experiment {
  description: string
  seeds?: number // runs per setting; seed 0 is the stored layout as is, others jitter it slightly
  runs: (Run & {
    name: string
    shownShare?: number // the share measured as `shown`; default the panel's
  })[]
}

export interface RunResult {
  project: string
  run: string
  seed: number
  settings: LayoutSettings
  ideas: number
  connections: number
  iterations: number
  lastMove: number
  milliseconds: number
  changes: number
  files: number // idea files changed when all changes are applied
  shownFiles: number // at the panel's default share
  placements: number
  full: LayoutMetrics // all changes applied
  shown: LayoutMetrics // the panel's default share applied
  before: LayoutMetrics // the stored layout (spacing misfit against the default spacing)
  positions?: Record<string, [number, number]> // seed 0 only, all changes applied, for the report's pictures
}

const LAB = import.meta.dirname
export const SHOWN_SHARE = 0.2 // GraphView's LAYOUT_PREVIEW_SHARE

const [experimentName, ...projectFilter] = process.argv.slice(2)
if (!experimentName) {
  console.error(`usage: pnpm layout-lab <experiment> [project...]\nexperiments: ${fs.readdirSync(path.join(LAB, 'experiments')).map(file => file.replace(/\.ts$/, '')).join(', ')}`)
  process.exit(1)
}
const projects = loadProjects(projectFilter)
const experiment: Experiment = (await import(path.join(LAB, 'experiments', `${experimentName}.ts`))).default

fs.mkdirSync(path.join(LAB, 'results'), { recursive: true })
const resultsFile = path.join(LAB, 'results', `${experimentName}.jsonl`)
fs.writeFileSync(resultsFile, '')
const results: RunResult[] = []
const graphs = new Map<string, { links: Snapshot['links']; radius: Map<string, number> }>()
for (const [project, projectPath] of projects) {
  for (let seed = 0; seed < (experiment.seeds ?? 3); seed++) {
    const snapshot = loadSnapshot(project, projectPath, seed)
    if (seed === 0) graphs.set(project, { links: snapshot.links, radius: new Map(snapshot.nodes.map(node => [node.id, node.radius])) })
    const before = measureLayout(snapshot.nodes, snapshot.links, undefined, { spacing: DEFAULT_LAYOUT_SETTINGS.spacing, semanticPairs: snapshot.semanticPairs })
    for (const run of experiment.runs) {
      const result = layOut(snapshot, run, seed, before)
      results.push(result)
      fs.appendFileSync(resultsFile, JSON.stringify(result) + '\n')
      console.log([project, run.name, `seed ${seed}`, `${result.iterations} iterations`, `${result.milliseconds} ms`,
        `crossings ${result.before.crossings} → ${result.full.crossings}`, `overlaps ${result.before.overlaps} → ${result.full.overlaps}`].join('  '))
    }
  }
}
writeReport(path.join(LAB, 'results', `${experimentName}.html`), experimentName, experiment.description, results, graphs)
console.log(`report: ${path.join(LAB, 'results', `${experimentName}.html`)}`)

function layOut(snapshot: Snapshot, run: Experiment['runs'][number], seed: number, before: LayoutMetrics): RunResult {
  const { nodes, links, semanticPairs } = snapshot
  const { settings, changes, placements, positions: full, iterations, lastMove, milliseconds } = solve(snapshot, run)
  const start = new Map(nodes.map(node => [node.id, node.position]))
  const context = { clearance: run.options?.clearance ?? 3, spacing: settings.spacing, start, semanticPairs }
  const shownCount = Math.round(changes.length * (run.shownShare ?? SHOWN_SHARE))
  return {
    project: snapshot.name,
    run: run.name,
    seed,
    settings,
    ideas: nodes.length,
    connections: links.length,
    iterations,
    lastMove,
    milliseconds,
    changes: changes.length,
    files: new Set(changes.map(change => change.parentId)).size,
    shownFiles: new Set(changes.slice(0, shownCount).map(change => change.parentId)).size,
    placements: placements.length,
    full: measureLayout(nodes, links, full, context),
    shown: measureLayout(nodes, links, applied(snapshot, changes.slice(0, shownCount), placements), context),
    before,
    positions: seed === 0 ? Object.fromEntries([...full].map(([id, [x, y]]) => [id, [Math.round(x), Math.round(y)]])) : undefined
  }
}
