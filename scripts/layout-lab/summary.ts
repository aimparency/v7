// The report's tables as text, for reading results in a terminal.
//
//   pnpm layout-lab:summary <experiment> [full|shown|before] [project...]
import fs from 'node:fs'
import path from 'node:path'
import { COLUMNS } from './report.ts'
import type { RunResult } from './run.ts'

const [experimentName, view = 'full', ...projectFilter] = process.argv.slice(2)
if (!experimentName || !['full', 'shown', 'before'].includes(view)) {
  console.error('usage: pnpm layout-lab:summary <experiment> [full|shown|before] [project...]')
  process.exit(1)
}
const results = fs.readFileSync(path.join(import.meta.dirname, 'results', `${experimentName}.jsonl`), 'utf8')
  .split('\n').filter(Boolean).map(line => JSON.parse(line) as RunResult)
  .filter(result => projectFilter.length === 0 || projectFilter.includes(result.project))

const width = Math.max(...results.map(result => result.run.length), 8)
for (const project of new Set(results.map(result => result.project))) {
  const own = results.filter(result => result.project === project)
  console.log(`\n${project} (${own[0]!.ideas} ideas, ${own[0]!.connections} connections), ${view}`)
  console.log(''.padEnd(width), ...COLUMNS.map(column => column.label.slice(0, 9).padStart(9)))
  for (const run of new Set(own.map(result => result.run))) {
    const cells = COLUMNS.map(column => {
      const values = own.filter(result => result.run === run).map(result => column.value(result, view as 'full' | 'shown' | 'before')).filter(Number.isFinite)
      return values.length === 0 ? '' : (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(column.digits)
    })
    console.log(run.padEnd(width), ...cells.map(cell => cell.padStart(9)))
  }
}
