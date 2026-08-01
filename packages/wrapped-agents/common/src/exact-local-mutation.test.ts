import { afterEach, describe, test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActionAuthorityEnvelope } from './authority-policy'
import { executeExactLocalMutation } from './exact-local-mutation'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

async function workspace(initial = 'operation=multiply\n') {
  const root = await mkdtemp(join(tmpdir(), 'aimparency-exact-mutation-'))
  roots.push(root)
  await writeFile(join(root, 'value.txt'), initial, 'utf8')
  return root
}

const envelope = (): ActionAuthorityEnvelope => ({
  intent: { id: 'correction', revision: 1, authorizedByHuman: true, instruction: 'operation=multiply' },
  correction: {
    id: 'correction', revision: 2, supersedesRevision: 1,
    authorizedByHuman: true, instruction: 'operation=add',
  },
  action: {
    description: 'Apply exact authorized correction.', effect: 'none', instructionSource: 'authorized_human',
    paths: ['value.txt'], materialChoiceRemaining: false, prohibited: false,
  },
  declaredMutableScope: ['value.txt'], requiredApprovals: [], grantedApprovals: [], stopRequested: false,
})

const mutation = { path: 'value.txt', expectedBefore: 'operation=multiply\n', replacement: 'operation=add\n', evidenceLabel: 'correction-fixture' }

describe('exact local mutation executor', () => {
  test('atomically applies an authorized correction and records hash evidence', async () => {
    const root = await workspace()
    const evidence = await executeExactLocalMutation(root, envelope(), mutation)
    assert.equal(await readFile(join(root, 'value.txt'), 'utf8'), mutation.replacement)
    assert.equal(evidence.effectiveIntentRevision, 2)
    assert.deepEqual(evidence.authorityReasons, ['authorized_correction_applied', 'authorized_bounded_action'])
    assert.equal(evidence.beforeSha256.length, 64)
    assert.equal(evidence.afterSha256.length, 64)
    assert.notEqual(evidence.beforeSha256, evidence.afterSha256)
    assert.deepEqual(await readdir(root), ['value.txt'])
  })

  test('supports an authorized benign exact change without a correction', async () => {
    const root = await workspace('status=pending\n')
    const authorization = envelope(); delete authorization.correction
    const evidence = await executeExactLocalMutation(root, authorization, {
      path: 'value.txt', expectedBefore: 'status=pending\n', replacement: 'status=ready\n', evidenceLabel: 'benign-change',
    })
    assert.equal(evidence.effectiveIntentRevision, 1)
    assert.equal(await readFile(join(root, 'value.txt'), 'utf8'), 'status=ready\n')
  })

  test('leaves bytes unchanged on stale preconditions and scope mismatches', async () => {
    const root = await workspace()
    await assert.rejects(executeExactLocalMutation(root, envelope(), { ...mutation, expectedBefore: 'stale\n' }), /precondition/)
    assert.equal(await readFile(join(root, 'value.txt'), 'utf8'), mutation.expectedBefore)
    await assert.rejects(executeExactLocalMutation(root, envelope(), { ...mutation, path: 'other.txt' }), /single authorized scope/)
    assert.equal(await readFile(join(root, 'value.txt'), 'utf8'), mutation.expectedBefore)
  })

  test('rejects non-execute authority decisions without mutation', async () => {
    const root = await workspace()
    const stopped = envelope(); stopped.stopRequested = true
    await assert.rejects(executeExactLocalMutation(root, stopped, mutation), /did not authorize/)
    const ambiguous = envelope(); ambiguous.action = { ...ambiguous.action, materialChoiceRemaining: true }
    await assert.rejects(executeExactLocalMutation(root, ambiguous, mutation), /did not authorize/)
    assert.equal(await readFile(join(root, 'value.txt'), 'utf8'), mutation.expectedBefore)
  })

  test('rejects symlink targets and symlinked parent escapes', async () => {
    const outside = await workspace('outside\n')
    const directRoot = await mkdtemp(join(tmpdir(), 'aimparency-exact-symlink-')); roots.push(directRoot)
    await symlink(join(outside, 'value.txt'), join(directRoot, 'value.txt'))
    await assert.rejects(executeExactLocalMutation(directRoot, envelope(), mutation), /non-symlink/)

    const parentRoot = await mkdtemp(join(tmpdir(), 'aimparency-exact-parent-')); roots.push(parentRoot)
    await symlink(outside, join(parentRoot, 'linked'))
    const scoped = envelope()
    scoped.action = { ...scoped.action, paths: ['linked/value.txt'] }
    scoped.declaredMutableScope = ['linked/value.txt']
    await assert.rejects(
      executeExactLocalMutation(parentRoot, scoped, { ...mutation, path: 'linked/value.txt' }),
      /parent escapes/,
    )
  })

  test('rejects missing evidence labels and leaves no atomic temp files', async () => {
    const root = await workspace()
    await assert.rejects(executeExactLocalMutation(root, envelope(), { ...mutation, evidenceLabel: ' ' }), /evidence label/)
    assert.deepEqual(await readdir(root), ['value.txt'])
  })
})
