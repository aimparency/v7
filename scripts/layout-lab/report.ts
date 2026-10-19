// The lab's report: per project, a table of the metrics (mean ± spread over
// seeds; green better, red worse than the first run beyond the noise) and a
// picture of each run's layout (seed 0).
import fs from 'node:fs'
import type { RunResult } from './run.ts'

type View = 'full' | 'before'
interface Column {
  label: string
  hint: string
  better: 'lower' | 'higher' | null
  value: (result: RunResult, view: View) => number
  digits: number
}

const perConnection = (count: number, result: RunResult) => count / Math.max(result.connections, 1)
const per100Ideas = (count: number, result: RunResult) => 100 * count / Math.max(result.ideas, 1)

export const COLUMNS: Column[] = [
  { label: 'crossings', hint: 'per connection', better: 'lower', digits: 2, value: (r, v) => perConnection(r[v].crossings, r) },
  { label: 'weighted', hint: 'crossings by strength, per connection', better: 'lower', digits: 2, value: (r, v) => perConnection(r[v].weightedCrossings, r) },
  { label: 'shallow', hint: 'share of crossings under 30°', better: 'lower', digits: 2, value: (r, v) => r[v].shallowCrossings / Math.max(r[v].crossings, 1) },
  { label: 'arrow overlap', hint: 'share of arrow ink on other arrows', better: 'lower', digits: 3, value: (r, v) => r[v].arrowOverlap },
  { label: 'under idea', hint: 'connections through a foreign idea, per connection', better: 'lower', digits: 3, value: (r, v) => perConnection(r[v].underIdea, r) },
  { label: 'overlaps', hint: 'pairs under 1 radius sum, per 100 ideas', better: 'lower', digits: 1, value: (r, v) => per100Ideas(r[v].overlaps, r) },
  { label: 'crowded', hint: 'pairs under the clearance, per 100 ideas', better: 'lower', digits: 1, value: (r, v) => per100Ideas(r[v].crowdedPairs, r) },
  { label: 'angle med', hint: 'narrowest gap at an idea / even gap, median', better: 'higher', digits: 2, value: (r, v) => r[v].angleMedian },
  { label: 'angle p10', hint: 'the same, 10th percentile', better: 'higher', digits: 2, value: (r, v) => r[v].angleLow },
  { label: 'length', hint: 'mean connection length, radius sums', better: null, digits: 2, value: (r, v) => r[v].meanLength },
  { label: 'misfit', hint: 'mean |length − spacing|', better: 'lower', digits: 2, value: (r, v) => r[v].lengthMisfit },
  { label: 'moved', hint: 'mean displacement, idea diameters', better: 'lower', digits: 2, value: (r, v) => r[v].displacementMean },
  { label: 'moved max', hint: 'largest displacement, idea diameters', better: 'lower', digits: 1, value: (r, v) => r[v].displacementMax },
  { label: 'similar near', hint: 'share of the 5 most similar among the 5 nearest', better: 'higher', digits: 3, value: (r, v) => r[v].semanticNeighbourhood },
  { label: 'behind', hint: 'share of children behind their parent', better: 'lower', digits: 3, value: (r, v) => r[v].outwardViolations },
  { label: 'iterations', hint: 'until rest (1200 = budget used up)', better: 'lower', digits: 0, value: r => r.iterations },
  { label: 'files', hint: 'idea files changed', better: 'lower', digits: 0, value: r => r.files }
]

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
const spread = (values: number[]) => values.length < 2 ? 0 : Math.sqrt(values.reduce((sum, value) => sum + (value - mean(values)) ** 2, 0) / (values.length - 1))
const escape = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!)

function table(project: string, results: RunResult[], view: View) {
  const runs = [...new Set(results.map(result => result.run))]
  const stats = runs.map(run => COLUMNS.map(column => {
    const values = results.filter(result => result.run === run).map(result => column.value(result, view)).filter(Number.isFinite)
    return values.length === 0 ? null : { mean: mean(values), spread: spread(values) }
  }))
  const head = `<tr><th>${escape(project)}</th>${COLUMNS.map(column => `<th title="${escape(column.hint)}">${column.label}</th>`).join('')}</tr>`
  const rows = runs.map((run, row) => `<tr><td>${escape(run)}</td>${COLUMNS.map((column, index) => {
    const cell = stats[row]![index]
    if (!cell) return '<td></td>'
    const base = stats[0]![index]
    let tone = ''
    if (row > 0 && base && column.better) {
      const noise = Math.max(cell.spread, base.spread, Math.abs(base.mean) * 0.02)
      const delta = cell.mean - base.mean
      if (Math.abs(delta) > noise) tone = (delta < 0) === (column.better === 'lower') ? 'better' : 'worse'
    }
    const text = cell.mean.toFixed(column.digits) + (cell.spread > 0 ? `<small> ±${cell.spread.toFixed(column.digits)}</small>` : '')
    return `<td class="${tone}">${text}</td>`
  }).join('')}</tr>`).join('')
  return `<table>${head}${rows}</table>`
}

function picture(result: RunResult, links: { parentId: string; childId: string }[], radius: Map<string, number>) {
  const positions = result.positions!
  const ids = Object.keys(positions)
  const xs = ids.flatMap(id => [positions[id]![0] - radius.get(id)!, positions[id]![0] + radius.get(id)!])
  const ys = ids.flatMap(id => [positions[id]![1] - radius.get(id)!, positions[id]![1] + radius.get(id)!])
  const [left, top] = [Math.min(...xs), Math.min(...ys)]
  const [width, height] = [Math.max(...xs) - left, Math.max(...ys) - top]
  const lines = links.map(({ parentId, childId }) => {
    const [a, b] = [positions[parentId], positions[childId]]
    return a && b ? `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>` : ''
  }).join('')
  const circles = ids.map(id => `<circle cx="${positions[id]![0]}" cy="${positions[id]![1]}" r="${radius.get(id)!.toFixed(0)}"/>`).join('')
  return `<figure><svg viewBox="${left} ${top} ${width} ${height}" style="--stroke:${(Math.max(width, height) / 600).toFixed(1)}">${lines}${circles}</svg><figcaption>${escape(result.run)}</figcaption></figure>`
}

export function writeReport(file: string, name: string, description: string, results: RunResult[], graphs: Map<string, { links: { parentId: string; childId: string }[]; radius: Map<string, number> }>) {
  const projects = [...new Set(results.map(result => result.project))]
  const sections = projects.map(project => {
    const own = results.filter(result => result.project === project)
    const graph = graphs.get(project)!
    const first = own[0]!
    return `<section><h2>${escape(project)} <small>${first.ideas} ideas, ${first.connections} connections</small></h2>
<h3>Solved</h3>${table(project, own, 'full')}
<h3>Stored layout</h3>${table(project, own.filter(result => result.run === first.run), 'before')}
<div class="pictures">${own.filter(result => result.positions).map(result => picture(result, graph.links, graph.radius)).join('')}</div></section>`
  }).join('')
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><title>Layout lab: ${escape(name)}</title><style>
:root { color-scheme: dark; --background: #161616; --text: #ddd; --line: #333; --better: #1f4d2b; --worse: #5a2323; }
body { background: var(--background); color: var(--text); font: 13px system-ui, sans-serif; margin: 16px; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums;
  & th, & td { border: 1px solid var(--line); padding: 2px 6px; text-align: right; }
  & th:first-child, & td:first-child { text-align: left; }
  & th { cursor: help; }
  & .better { background: var(--better); }
  & .worse { background: var(--worse); }
  & small { opacity: 0.6; }
}
.pictures { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;
  & figure { margin: 0; width: 320px; }
  & svg { width: 320px; height: 320px; background: #0d0d0d;
    & line { stroke: #6a8; stroke-width: var(--stroke); opacity: 0.6; }
    & circle { fill: #48a; fill-opacity: 0.35; stroke: none; }
  }
}
</style></head><body><h1>Layout lab: ${escape(name)}</h1><p>${escape(description)}</p>${sections}</body></html>`)
}
