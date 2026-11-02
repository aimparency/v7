import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_BIND_HOST,
  isAllowedBrowserOrigin,
  isAllowedClientOrigin,
  resolveBindHost,
} from './network-policy.js';

test('binds to IPv4 loopback unless the operator configures a host', () => {
  assert.equal(resolveBindHost(undefined), DEFAULT_BIND_HOST);
  assert.equal(resolveBindHost(''), DEFAULT_BIND_HOST);
  assert.equal(resolveBindHost(' 100.107.183.63 '), '100.107.183.63');
});

test('allows loopback browser origins across HTTP variants and ports', () => {
  for (const origin of [
    'http://localhost:4000',
    'https://127.0.0.1:4443',
    'http://[::1]:5173',
  ]) {
    assert.equal(isAllowedBrowserOrigin(origin, undefined), true, origin);
  }
});

test('allows only the explicitly configured remote hostname', () => {
  assert.equal(isAllowedBrowserOrigin('http://100.107.183.63:4000', '100.107.183.63'), true);
  assert.equal(isAllowedBrowserOrigin('https://aimparency.internal', 'AIMPARENCY.INTERNAL'), true);
  assert.equal(isAllowedBrowserOrigin('http://100.107.183.64:4000', '100.107.183.63'), false);
});

test('rejects malformed, opaque, credentialed, and unrelated browser origins', () => {
  for (const origin of [
    'not a URL',
    'null',
    'file:///tmp/client.html',
    'http://user:pass@localhost:4000',
    'https://attacker.example',
  ]) {
    assert.equal(isAllowedBrowserOrigin(origin, undefined), false, origin);
    assert.equal(isAllowedClientOrigin(origin, undefined), false, origin);
  }
});

test('browser-only servers reject a missing Origin; servers for local programs accept it', () => {
  assert.equal(isAllowedBrowserOrigin(undefined, undefined), false);
  assert.equal(isAllowedClientOrigin(undefined, undefined), true);
  assert.equal(isAllowedClientOrigin('http://localhost:4000', undefined), true);
});
