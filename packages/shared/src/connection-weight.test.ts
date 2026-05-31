import { test } from 'node:test';
import assert from 'node:assert';
import {
  MAX_SHARE,
  weightToShare,
  shareToWeight,
  defaultWeight,
  clampShare,
  isSoleContributor,
} from './connection-weight.js';

const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);

test('weightToShare: sole contributor (S+L=0) is 100%', () => {
  close(weightToShare(1, 0, 0), 1);
  close(weightToShare(5, 0, 0), 1);
});

test('weightToShare: splits against siblings and loop', () => {
  close(weightToShare(1, 1, 0), 0.5); // one sibling, equal
  close(weightToShare(1, 0, 1), 0.5); // loop only, equal
  close(weightToShare(1, 1, 2), 1 / 4); // S=1,L=2 → 1/(1+2+1)
});

test('shareToWeight is the inverse of weightToShare', () => {
  for (const [S, L] of [[1, 0], [3, 2], [0, 4], [10, 0]]) {
    const p = 0.3;
    const w = shareToWeight(p, S, L);
    close(weightToShare(w, S, L), p);
  }
});

test('shareToWeight: base 0 returns 1 (any weight = 100%)', () => {
  close(shareToWeight(0.42, 0, 0), 1);
});

test('shareToWeight: clamps above MAX_SHARE', () => {
  // request 99% with a sibling present → clamped to 90%
  const w = shareToWeight(0.99, 1, 0);
  close(weightToShare(w, 1, 0), MAX_SHARE);
});

test('shareToWeight: 90% against sum S+L gives 9× that sum', () => {
  close(shareToWeight(0.9, 1, 0), 9); // 0.9*1/0.1
  close(shareToWeight(0.9, 2, 1), 27); // 0.9*3/0.1
});

test('defaultWeight: sole supporter, no loop → 1 (100%)', () => {
  close(defaultWeight(0, 0, 0), 1);
});

test('defaultWeight: equal to average existing sibling weight when no loop', () => {
  // two siblings of weight 2 and 4 (S=6, n=2) → avg 3
  close(defaultWeight(6, 0, 2), 3);
  close(weightToShare(defaultWeight(6, 0, 2), 6, 0), 3 / 9); // 1/3 share
});

test('defaultWeight: first child with loop L>0 → 50/50 with loop', () => {
  close(defaultWeight(0, 2, 0), 2);
  close(weightToShare(defaultWeight(0, 2, 0), 0, 2), 0.5);
});

test('clampShare bounds', () => {
  close(clampShare(-1), 0);
  close(clampShare(0.5), 0.5);
  close(clampShare(1), MAX_SHARE);
  close(clampShare(NaN), 0);
});

test('isSoleContributor', () => {
  assert.equal(isSoleContributor(0, 0), true);
  assert.equal(isSoleContributor(1, 0), false);
  assert.equal(isSoleContributor(0, 1), false);
});
