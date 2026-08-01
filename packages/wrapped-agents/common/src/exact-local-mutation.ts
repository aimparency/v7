import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { evaluateActionAuthority, type ActionAuthorityEnvelope, type AuthorityReason } from './authority-policy'

export interface ExactLocalMutation {
  path: string
  expectedBefore: string
  replacement: string
  evidenceLabel: string
}

export interface ExactLocalMutationEvidence {
  path: string
  evidenceLabel: string
  beforeSha256: string
  afterSha256: string
  effectiveIntentRevision: number
  authorityReasons: readonly AuthorityReason[]
}

const sha256 = (content: string): string => createHash('sha256').update(content).digest('hex')

export async function executeExactLocalMutation(
  root: string,
  envelope: Readonly<ActionAuthorityEnvelope>,
  mutation: Readonly<ExactLocalMutation>,
): Promise<ExactLocalMutationEvidence> {
  const policy = evaluateActionAuthority(envelope)
  if (policy.disposition !== 'execute') throw new Error(`Authority policy did not authorize execution: ${policy.reasons.join(', ')}`)
  if (envelope.action.effect !== 'none' && envelope.action.effect !== 'destructive_local') {
    throw new Error('Exact local mutation cannot carry external, credential, or permission effects')
  }
  if (envelope.declaredMutableScope.length !== 1 || envelope.action.paths.length !== 1
    || envelope.declaredMutableScope[0] !== mutation.path || envelope.action.paths[0] !== mutation.path) {
    throw new Error('Exact local mutation path does not equal the single authorized scope')
  }
  if (!mutation.evidenceLabel.trim()) throw new Error('Exact local mutation requires an evidence label')

  const canonicalRoot = await realpath(root)
  const target = resolve(canonicalRoot, mutation.path)
  const relativeTarget = relative(canonicalRoot, target)
  if (!relativeTarget || relativeTarget.startsWith('..') || relativeTarget.startsWith('/')) {
    throw new Error('Exact local mutation target escapes or aliases the root')
  }
  const canonicalParent = await realpath(dirname(target))
  if (canonicalParent !== canonicalRoot && !canonicalParent.startsWith(`${canonicalRoot}/`)) {
    throw new Error('Exact local mutation parent escapes the root')
  }
  const targetStat = await lstat(target)
  if (!targetStat.isFile() || targetStat.isSymbolicLink()) throw new Error('Exact local mutation target must be a regular non-symlink file')

  const before = await readFile(target, 'utf8')
  if (before !== mutation.expectedBefore) throw new Error('Exact local mutation precondition mismatch')
  const temp = join(canonicalParent, `.${randomUUID()}.aimparency-mutation.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temp, 'wx', targetStat.mode & 0o777)
    await handle.writeFile(mutation.replacement, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    if (await readFile(temp, 'utf8') !== mutation.replacement) {
      throw new Error('Exact local mutation temporary verification mismatch')
    }
    await rename(temp, target)
    const after = await readFile(target, 'utf8')
    if (after !== mutation.replacement) throw new Error('Exact local mutation verification mismatch')
    return {
      path: mutation.path,
      evidenceLabel: mutation.evidenceLabel,
      beforeSha256: sha256(before),
      afterSha256: sha256(after),
      effectiveIntentRevision: policy.effectiveIntentRevision,
      authorityReasons: policy.reasons,
    }
  } finally {
    await handle?.close().catch(() => undefined)
    await rm(temp, { force: true })
  }
}
