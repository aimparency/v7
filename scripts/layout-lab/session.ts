// A rating session: pairs of autolayout settings, each solved on every
// project and drawn side by side with the app's own graph renderer, to pick
// the nicer one and say why. The page copies a report to paste back.
//
//   pnpm layout-lab:session [comparisons=10] [seed] [project...]
//
// Most comparisons turn one setting from far below to far above its slider
// range, the rest set every setting at random against the defaults. Writes
// results/sessions/<id>.html (the page) and <id>.json (with metrics).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { LayoutSettings } from '../../packages/shared/src/types.ts'
import { DEFAULT_LAYOUT_SETTINGS } from '../../packages/frontend/src/utils/autolayout.ts'
import { measureLayout } from '../../packages/frontend/src/utils/layout-metrics.ts'
import { loadSnapshot, mulberry32 } from './snapshot.ts'
import { loadProjects, solve } from './solve.ts'
import type { SessionComparison, SessionData, SessionProject } from './viewer/session-data.ts'

// Beyond the panel's slider ranges, about three times on both ends.
const EXTREMES: Record<keyof LayoutSettings, [number, number]> = {
  spacing: [3, 7],
  memory: [0.1, 30],
  length: [0.2, 60],
  spread: [0.03, 15],
  outward: [0.05, 45],
  semantic: [0.003, 0.3], // 0 (the default) is the low end
  isolatedSemantic: [0.03, 30]
}
const KNOBS = Object.keys(EXTREMES) as (keyof LayoutSettings)[]

const LAB = import.meta.dirname
const [count = '10', seedArgument = String(Date.now() % 1e6)] = process.argv.slice(2)
const seed = Number(seedArgument)
const random = mulberry32(seed)
const between = (low: number, high: number) => low * (high / low) ** random()
const round = (value: number) => Number(value.toPrecision(2))

// From well below the default to well above it, or 0 for a default of 0.
function low(knob: keyof LayoutSettings) {
  const [min] = EXTREMES[knob]
  const fallback = DEFAULT_LAYOUT_SETTINGS[knob]
  if (knob === 'spacing') return round(min + random() * 0.3)
  return fallback === 0 ? 0 : round(between(min, fallback / 3))
}
function high(knob: keyof LayoutSettings) {
  const [min, max] = EXTREMES[knob]
  const fallback = DEFAULT_LAYOUT_SETTINGS[knob]
  if (knob === 'spacing') return round(max - random() * 1.5)
  return round(between(fallback === 0 ? min * 10 : fallback * 3, max))
}
function anywhere(): LayoutSettings {
  return Object.fromEntries(KNOBS.map(knob => {
    const [min, max] = EXTREMES[knob]
    if (knob === 'spacing') return [knob, round(min + random() * (max - min))]
    if (knob === 'semantic' && random() < 0.5) return [knob, 0]
    return [knob, round(between(min, max))]
  })) as LayoutSettings
}

const pairs: { change: string; sides: [LayoutSettings, LayoutSettings] }[] = []
const knobs = shuffle([...KNOBS])
for (let index = 0; index < Number(count); index++) {
  const knob = knobs[index]
  if (knob && index < Number(count) - 3) {
    pairs.push({ change: `${knob} low vs high`, sides: [{ ...DEFAULT_LAYOUT_SETTINGS, [knob]: low(knob) }, { ...DEFAULT_LAYOUT_SETTINGS, [knob]: high(knob) }] })
  } else {
    pairs.push({ change: 'all random vs defaults', sides: [anywhere(), { ...DEFAULT_LAYOUT_SETTINGS }] })
  }
}
shuffle(pairs)
for (const pair of pairs) if (random() < 0.5) pair.sides.reverse()

const now = new Date()
const two = (value: number) => String(value).padStart(2, '0')
const id = `session-${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`
const projects: SessionProject[] = []
const metrics: Record<string, unknown>[][] = pairs.map(() => [])
const layouts: number[][][] = pairs.map(() => [])
const solved = new Map<string, { layout: number[]; metrics: Record<string, unknown> }>()
for (const [name, projectPath] of loadProjects(process.argv.slice(4))) {
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
  pairs.forEach((pair, at) => {
    for (const settings of pair.sides) {
      const key = `${name} ${JSON.stringify(settings)}`
      if (!solved.has(key)) {
        const result = solve(snapshot, { settings })
        const measured = measureLayout(snapshot.nodes, snapshot.links, result.positions, { spacing: settings.spacing, start, semanticPairs: snapshot.semanticPairs })
        solved.set(key, {
          layout: snapshot.nodes.flatMap(node => result.positions.get(node.id)!.map(Math.round)),
          metrics: { ...measured, iterations: result.iterations, files: new Set(result.changes.map(change => change.parentId)).size }
        })
        console.log(`${name}  comparison ${at + 1}  ${result.iterations} iterations  ${result.milliseconds} ms  crossings ${measured.crossings}`)
      }
      layouts[at]!.push(solved.get(key)!.layout)
      metrics[at]!.push({ project: name, ...solved.get(key)!.metrics })
    }
  })
}

const comparisons: SessionComparison[] = pairs.map((pair, at) => ({
  change: pair.change,
  sides: [0, 1].map(side => ({ settings: pair.sides[side]!, layouts: projects.map((_, project) => layouts[at]![project * 2 + side]!) })) as SessionComparison['sides']
}))
const session: SessionData = { id, projects, comparisons }

const out = path.join(LAB, 'results', 'sessions')
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify({ seed, comparisons: pairs.map((pair, at) => ({ ...pair, metrics: metrics[at] })) }, null, 1))
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

