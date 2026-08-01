import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoPermissionBypass } from './process-authority-policy';

test('allows ordinary model, resume, and bounded approval arguments', () => {
  assert.doesNotThrow(() =>
    assertNoPermissionBypass(
      ['--continue', '--model', 'example', '--approval-mode', 'auto_edit'],
      'worker',
    ),
  );
});

test('rejects standalone permission and sandbox bypass arguments for either role', () => {
  for (const role of ['worker', 'watchdog'] as const) {
    for (const argument of [
      '--dangerously-skip-permissions',
      '--dangerously-bypass-approvals-and-sandbox',
      '--yolo',
    ]) {
      assert.throws(
        () => assertNoPermissionBypass([argument], role),
        new RegExp(`Refusing to start ${role}.*${argument}`),
      );
    }
  }
});

test('rejects split and equals forms of no-approval modes', () => {
  for (const args of [
    ['--ask-for-approval', 'never'],
    ['--approval-policy', 'NEVER'],
    ['--approval-mode', 'yolo'],
    ['--ask-for-approval=never'],
    ['--approval-policy=never'],
    ['--approval-mode=yolo'],
  ]) {
    assert.throws(() => assertNoPermissionBypass(args, 'worker'), /forbidden permission-bypass/);
  }
});

test('does not mutate the caller-owned argument list', () => {
  const args = ['--model', 'example'];
  assertNoPermissionBypass(args, 'watchdog');
  assert.deepEqual(args, ['--model', 'example']);
});
