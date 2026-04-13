import fs from 'fs-extra';
import path from 'path';
import { execFileSync } from 'node:child_process';

type PhaseRecord = {
  id: string
  name: string
  parent: string | null
  commitments: string[]
  from: number
  to: number
  order?: number
  childPhaseIds?: string[]
}

type ProjectMeta = {
  name: string
  color: string
  statuses?: unknown[]
  dataModelVersion?: number
  phaseCursors?: Record<string, number>
  phaseActiveLevel?: number
  rootPhaseIds?: string[]
}

function usage(): never {
  console.error('Usage: tsx packages/backend/scripts/recover-phase-tree.ts <project-root-or-.bowman> <fallback-commit>')
  process.exit(1)
}

function resolveBowmanPath(inputPath: string): string {
  const resolved = path.resolve(inputPath)
  return resolved.endsWith('.bowman') ? resolved : path.join(resolved, '.bowman')
}

function gitShow(repoRoot: string, revPath: string): string {
  return execFileSync('git', ['-C', repoRoot, 'show', revPath], { encoding: 'utf8' })
}

function gitFileExists(repoRoot: string, commit: string, filePath: string): boolean {
  try {
    execFileSync('git', ['-C', repoRoot, 'cat-file', '-e', `${commit}:${filePath}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function parsePhaseOrNull(contents: string): PhaseRecord | null {
  try {
    const parsed = JSON.parse(contents)
    if (
      !parsed ||
      typeof parsed.id !== 'string' ||
      typeof parsed.name !== 'string' ||
      (parsed.parent !== null && typeof parsed.parent !== 'string') ||
      !Array.isArray(parsed.commitments) ||
      typeof parsed.from !== 'number' ||
      typeof parsed.to !== 'number'
    ) {
      return null
    }

    return parsed as PhaseRecord
  } catch {
    return null
  }
}

async function main() {
  const [, , projectArg, fallbackCommit] = process.argv
  if (!projectArg || !fallbackCommit) usage()

  const bowmanPath = resolveBowmanPath(projectArg)
  const repoRoot = path.dirname(bowmanPath)
  const phasesDir = path.join(bowmanPath, 'phases')
  const metaPath = path.join(bowmanPath, 'meta.json')

  if (!(await fs.pathExists(phasesDir))) {
    throw new Error(`Phases directory not found: ${phasesDir}`)
  }

  const backupRoot = path.join(bowmanPath, 'recovery-backups', new Date().toISOString().replace(/[:.]/g, '-'))
  await fs.ensureDir(backupRoot)

  const phaseFiles = (await fs.readdir(phasesDir))
    .filter((file) => file.endsWith('.json'))
    .sort()

  const phases = new Map<string, PhaseRecord>()
  const restored: string[] = []
  const stillBroken: string[] = []
  const missingInFallback: string[] = []

  for (const file of phaseFiles) {
    const currentPath = path.join(phasesDir, file)
    const currentContents = await fs.readFile(currentPath, 'utf8')
    let parsed = parsePhaseOrNull(currentContents)

    if (!parsed) {
      const gitPath = `.bowman/phases/${file}`
      if (!gitFileExists(repoRoot, fallbackCommit, gitPath)) {
        missingInFallback.push(file)
        stillBroken.push(file)
        continue
      }

      const fallbackContents = gitShow(repoRoot, `${fallbackCommit}:${gitPath}`)
      const fallbackParsed = parsePhaseOrNull(fallbackContents)
      if (!fallbackParsed) {
        stillBroken.push(file)
        continue
      }

      await fs.copy(currentPath, path.join(backupRoot, file))
      await fs.writeFile(currentPath, fallbackContents, 'utf8')
      parsed = fallbackParsed
      restored.push(file)
    }

    phases.set(parsed.id, parsed)
  }

  const sortableRoots = [...phases.values()]
    .filter((phase) => phase.parent === null)
    .sort((a, b) => {
      const aSort = typeof a.order === 'number' ? a.order : (a.from + a.to) / 2
      const bSort = typeof b.order === 'number' ? b.order : (b.from + b.to) / 2
      return aSort - bSort
    })

  const childrenByParent = new Map<string, PhaseRecord[]>()
  for (const phase of phases.values()) {
    if (!phase.parent) continue
    const bucket = childrenByParent.get(phase.parent) ?? []
    bucket.push(phase)
    childrenByParent.set(phase.parent, bucket)
  }

  for (const [parentId, children] of childrenByParent.entries()) {
    children.sort((a, b) => {
      const aSort = typeof a.order === 'number' ? a.order : (a.from + a.to) / 2
      const bSort = typeof b.order === 'number' ? b.order : (b.from + b.to) / 2
      return aSort - bSort
    })

    const parent = phases.get(parentId)
    if (!parent) continue
    parent.childPhaseIds = children.map((child) => child.id)
  }

  for (const phase of phases.values()) {
    if (!childrenByParent.has(phase.id)) {
      phase.childPhaseIds = []
    }
  }

  for (const phase of phases.values()) {
    const currentPath = path.join(phasesDir, `${phase.id}.json`)
    await fs.copy(currentPath, path.join(backupRoot, `${phase.id}.json.rebuilt`))
    await fs.writeJson(currentPath, phase, { spaces: 2 })
  }

  const currentMeta = (await fs.readJson(metaPath)) as ProjectMeta
  await fs.copy(metaPath, path.join(backupRoot, 'meta.json'))
  const nextMeta: ProjectMeta = {
    ...currentMeta,
    rootPhaseIds: sortableRoots.map((phase) => phase.id)
  }
  await fs.writeJson(metaPath, nextMeta, { spaces: 2 })

  console.log(JSON.stringify({
    bowmanPath,
    fallbackCommit,
    backupRoot,
    totalPhaseFiles: phaseFiles.length,
    parsedPhases: phases.size,
    restoredCount: restored.length,
    restored,
    stillBrokenCount: stillBroken.length,
    stillBroken,
    missingInFallbackCount: missingInFallback.length,
    missingInFallback,
    rootPhaseIds: nextMeta.rootPhaseIds ?? []
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
