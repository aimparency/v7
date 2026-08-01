import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SESSION_BIND_HOST,
  isAllowedSessionOrigin,
  resolveSessionBindHost,
} from './session-network-policy';

test('binds sessions to IPv4 loopback unless the operator configures a host', () => {
  assert.equal(resolveSessionBindHost(undefined), DEFAULT_SESSION_BIND_HOST);
  assert.equal(resolveSessionBindHost(''), DEFAULT_SESSION_BIND_HOST);
  assert.equal(resolveSessionBindHost(' 100.107.183.63 '), '100.107.183.63');
});

test('allows loopback browser origins across HTTP variants and ports', () => {
  for (const origin of [
    'http://localhost:4000',
    'https://127.0.0.1:4443',
    'http://[::1]:5173',
  ]) {
    assert.equal(isAllowedSessionOrigin(origin, undefined), true, origin);
  }
});

test('allows only the explicitly configured remote hostname', () => {
  assert.equal(isAllowedSessionOrigin('http://100.107.183.63:4000', '100.107.183.63'), true);
  assert.equal(isAllowedSessionOrigin('https://aimparency.internal', 'AIMPARENCY.INTERNAL'), true);
  assert.equal(isAllowedSessionOrigin('http://100.107.183.64:4000', '100.107.183.63'), false);
});

test('rejects malformed, opaque, credentialed, and unrelated browser origins', () => {
  for (const origin of [
    'not a URL',
    'null',
    'file:///tmp/client.html',
    'http://user:pass@localhost:4000',
    'https://attacker.example',
  ]) {
    assert.equal(isAllowedSessionOrigin(origin, undefined), false, origin);
  }
});

test('rejects clients without a browser Origin header', () => {
  assert.equal(isAllowedSessionOrigin(undefined, undefined), false);
});
