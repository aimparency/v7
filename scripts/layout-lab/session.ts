// A rating session: pairs of autolayout settings, each solved on every
// project and drawn side by side with the app's own graph renderer, to pick
// the nicer one and say why. The page copies a report to paste back.
//
//   pnpm layout-lab:session <design> [project...]
//
// <design> names a module in sessions/ (see SessionDesign). Comparisons and
// sides are shuffled, so the rating is blind. Writes
// results/sessions/<id>.html (the page) and <id>.json (with metrics); keep
// the pasted report in ratings/<id>.json next to a copy of the metrics.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { measureLayout } from '../../packages/frontend/src/utils/layout-metrics.ts'
import { loadSnapshot, mulberry32 } from './snapshot.ts'
import { loadProjects, solve, type Run } from './solve.ts'
import type { SessionComparison, SessionData, SessionProject, SessionSide } from './viewer/session-data.ts'

type Side = Pick<Run, 'settings' | 'weights'> // unset: the defaults
export interface SessionDesign {
  description: string
  comparisons: { hypothesis: string; sides: [Side, Side] }[]
}

const LAB = import.meta.dirname
const [designName, ...projectFilter] = process.argv.slice(2)
if (!designName) {
  console.error(`usage: pnpm layout-lab:session <design> [project...]\ndesigns: ${fs.readdirSync(path.join(LAB, 'sessions')).map(file => file.replace(/\.ts$/, '')).join(', ')}`)
  process.exit(1)
}
const design: SessionDesign = (await import(path.join(LAB, 'sessions', `${designName}.ts`))).default
const seed = Date.now() % 1e6
const random = mulberry32(seed)
const pairs = shuffle(design.comparisons.map(comparison => ({ ...comparison, sides: [...comparison.sides] as [Side, Side] })))
for (const pair of pairs) if (random() < 0.5) pair.sides.reverse()

const now = new Date()
const two = (value: number) => String(value).padStart(2, '0')
const id = `session-${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`
const projects: SessionProject[] = []
const sides: SessionSide[][] = pairs.map(() => [])
const metrics: Record<string, unknown>[][] = pairs.map(() => [])
const solved = new Map<string, { settings: SessionSide['settings']; layout: number[]; metrics: Record<string, unknown> }>()
for (const [name, projectPath] of loadProjects(projectFilter)) {
  const snapshot = loadSnapshot(name, projectPath, 0)
  const index = new Map(snapshot.nodes.map((node, at) => [node.id, at]))
  projects.push({
    name,
    radius: snapshot.nodes.map(node => Math.round(node.radius)),
    labels: snapshot.labels.map(label => label.text),
    states: snapshot.labels.map(label => label.state),
    statuses: snapshot.statuses,
    links: snapshot.links.map((link, at) => [index.get(link.childId)!, index.get(link.parentId)!, Number(snapshot.attributionShares[at]!.toFixed(3))])
  })
  const start = new Map(snapshot.nodes.map(node => [node.id, node.position]))
  pairs.forEach((pair, at) => pair.sides.forEach((side, sideIndex) => {
    const key = `${name} ${JSON.stringify(side)}`
    if (!solved.has(key)) {
      const result = solve(snapshot, side)
      const measured = measureLayout(snapshot.nodes, snapshot.links, result.positions, { spacing: result.settings.spacing, start, semanticPairs: snapshot.semanticPairs })
      solved.set(key, {
        settings: result.settings,
        layout: snapshot.nodes.flatMap(node => result.positions.get(node.id)!.map(Math.round)),
        metrics: { ...measured, iterations: result.iterations, files: new Set(result.changes.map(change => change.parentId)).size }
      })
      console.log(`${name}  comparison ${at + 1}  ${result.iterations} iterations  ${result.milliseconds} ms  crossings ${measured.crossings}`)
    }
    const { settings, layout, metrics: measured } = solved.get(key)!
    sides[at]![sideIndex] ??= { settings, mechanics: side.weights, layouts: [] }
    sides[at]![sideIndex]!.layouts.push(layout)
    metrics[at]!.push({ project: name, side: sideIndex === 0 ? 'left' : 'right', ...measured })
  }))
}
const comparisons: SessionComparison[] = pairs.map((pair, at) => ({ hypothesis: pair.hypothesis, sides: sides[at] as SessionComparison['sides'] }))
const session: SessionData = { id, projects, comparisons }

const out = path.join(LAB, 'results', 'sessions')
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify({
  design: designName,
  seed,
  comparisons: comparisons.map((comparison, at) => ({
    hypothesis: comparison.hypothesis,
    sides: comparison.sides.map(side => ({ ...side.settings, ...side.mechanics })),
    metrics: metrics[at]
  }))
}, null, 1))
fs.writeFileSync(path.join(out, `${id}.html`), page(session))
console.log(`session: ${path.join(out, `${id}.html`)}`)

// The viewer, built with the frontend's Vite (it imports the app's WebGL
// renderer and shaders), inlined with the session into one file.
function page(data: SessionData) {
  const build = path.join(LAB, 'results', '.viewer-build')
  execFileSync('pnpm', ['--filter', 'frontend', 'exec', 'vite', 'build', path.join(LAB, 'viewer'), '--outDir', build, '--emptyOutDir', '--base', './', '--logLevel', 'warn'], { stdio: 'inherit' })
  const inline = (text: string) => text.replace(/<\/script/gi, '<\\/script')
  return fs.readFileSync(path.join(build, 'index.html'), 'utf8')
    .replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/, (_, file: string) =>
      `<script id="session" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>\n<script type="module">${inline(fs.readFileSync(path.join(build, file), 'utf8'))}</script>`)
    .replace(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/, (_, file: string) => `<style>${fs.readFileSync(path.join(build, file), 'utf8')}</style>`)
}

function shuffle<T>(items: T[]) {
  for (let index = items.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1))
    ;[items[index], items[other]] = [items[other]!, items[index]!]
  }
  return items
}
