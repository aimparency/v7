// Login with a key that lives in the visitor's browser (ECDSA P-256, made by
// WebCrypto there, the private half not extractable). The server hands out a
// challenge, the browser signs it, the server checks the signature against the
// public key: nothing secret ever travels.

import crypto from 'node:crypto';
import { loginChallengeMessage } from 'shared';

const CHALLENGE_MS = 2 * 60_000;
const MAX_CHALLENGES = 10_000;
const challenges = new Map<string, number>(); // nonce -> expiry

export function newChallenge(now = Date.now()): string {
  for (const [nonce, expiry] of challenges) if (expiry < now) challenges.delete(nonce);
  if (challenges.size >= MAX_CHALLENGES) challenges.clear(); // asked for by anyone: bound the map
  const nonce = crypto.randomBytes(24).toString('base64url');
  challenges.set(nonce, now + CHALLENGE_MS);
  return nonce;
}

/** True when `signature` (IEEE P1363, base64) over the challenge is the key's. A challenge works once. */
export function verifyKeyLogin(publicKey: string, nonce: string, signature: string, now = Date.now()): boolean {
  const expiry = challenges.get(nonce);
  challenges.delete(nonce);
  if (expiry === undefined || expiry < now) return false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return false;
    return crypto.verify('sha256', Buffer.from(loginChallengeMessage(nonce)), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}
