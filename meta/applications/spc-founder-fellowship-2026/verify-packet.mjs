#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packetDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(packetDir, '../../..')
const aimsDir = join(repoRoot, '.bowman/aims')
const phasesDir = join(repoRoot, '.bowman/phases')

const ids = {
  application: 'b52d435e-72b5-4839-b0cd-fbc916b46a03',
  phase: 'dac299a1-e978-48ea-8552-ee5c2d2838ae',
  autonomy: 'cffdcd91-fd9c-45e4-98fd-e265650be143',
  economics: '3253bc9e-14fe-4c9b-9849-588620518517',
  draft: 'ad38cee4-2562-49b3-877f-e1b686e72300',
  proof: 'ef0d8f25-72d0-4ca0-8276-e69da4e6fd38',
  founder: 'ece096c7-9a22-4b9f-8e02-51ef09326929',
  boardy: '4a36d8ae-656f-45d6-97c8-a6990275cc99',
  submit: 'd7f7c26b-b5ba-442e-84b3-05b65a9a26e1',
}

const expectedChildren = [ids.draft, ids.proof, ids.founder, ids.boardy, ids.submit]
const expectedHumanGates = [ids.founder, ids.boardy, ids.submit]
const expectedDeadline = 1785740340000
const failures = []
const passes = []

function check(condition, label, detail = '') {
  if (condition) passes.push(label)
  else failures.push(detail ? `${label}: ${detail}` : label)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readAim(id) {
  return readJson(join(aimsDir, `${id}.json`))
}

function childIds(aim) {
  return (aim.supportingConnections ?? []).map((entry) =>
    typeof entry === 'string' ? entry : entry.aimId,
  )
}

function normalizedBlockquoteLengths(markdown, heading) {
  const section = markdown.split(`### ${heading}\n`)[1]?.split('\n### ')[0] ?? ''
  const groups = []
  let current = []
  for (const line of section.split('\n')) {
    if (line.startsWith('>')) current.push(line.slice(1).trim())
    else if (current.length > 0) {
      groups.push(current)
      current = []
    }
  }
  if (current.length > 0) groups.push(current)
  return groups.map((lines) => lines.join(' ').replace(/\s+/g, ' ').trim().length)
}

const application = readAim(ids.application)
const phase = readJson(join(phasesDir, `${ids.phase}.json`))
const children = childIds(application)

check(
  [ids.autonomy, ids.economics].every((id) => application.supportedAims?.includes(id)),
  'application retains both mission parents',
)
check(
  expectedChildren.every((id) => children.includes(id)) && children.length === expectedChildren.length,
  'application has exactly the five expected child aims',
  `found ${children.join(', ')}`,
)
check(
  application.committedIn?.includes(ids.phase) && phase.commitments?.includes(ids.application),
  'application and phase commitments are bidirectional',
)
check(phase.to === expectedDeadline, 'phase deadline is 3 Aug 2026 08:59 Berlin')

for (const id of expectedChildren) {
  const child = readAim(id)
  check(child.supportedAims?.includes(ids.application), `child ${id.slice(0, 8)} links to application`)
}

for (const id of expectedHumanGates) {
  const aim = readAim(id)
  check(aim.status?.state === 'human-dependent', `human gate ${id.slice(0, 8)} is human-dependent`)
}

const assembly = readFileSync(join(packetDir, 'submission-assembly.md'), 'utf8')
check(
  assembly.includes("**FELIX DECISION, 1 AUGUST 2026:** `I'm exploring`."),
  "submission assembly records `I'm exploring` exactly",
)

for (const heading of ['PROUD', 'ARTIFACTS', 'OTHER']) {
  const lengths = normalizedBlockquoteLengths(assembly, heading)
  check(
    lengths.length > 0 && lengths.every((length) => length > 0 && length < 1000),
    `${heading} answer variants are within 1,000 characters`,
    `${lengths.join(', ')} characters`,
  )
}

const packetReadme = readFileSync(join(packetDir, 'README.md'), 'utf8')
const localMarkdownLinks = [...packetReadme.matchAll(/`([^`]+\.md)`/g)].map((match) => match[1])
for (const relativePath of new Set(localMarkdownLinks)) {
  check(existsSync(join(packetDir, relativePath)), `README target exists: ${relativePath}`)
}

const report = {
  valid: failures.length === 0,
  passed: passes.length,
  failed: failures.length,
  answerCharacters: Object.fromEntries(
    ['PROUD', 'ARTIFACTS', 'OTHER'].map((heading) => [
      heading,
      normalizedBlockquoteLengths(assembly, heading),
    ]),
  ),
  failures,
}

console.log(JSON.stringify(report, null, 2))
if (failures.length > 0) process.exitCode = 1
