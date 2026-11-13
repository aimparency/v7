// Login by signing with a crypto wallet: Sign-In with Ethereum (EIP-4361),
// checked here and nowhere else. The server writes the message (its own
// address as the domain, a nonce it remembers, an end time), the wallet signs
// it, and the server recovers the signing address from the signature. Wallets
// that are contracts would need a look at a chain and are not supported.

import { getAddress, verifyMessage, type Hex } from 'viem';
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from 'viem/siwe';

const CHALLENGE_MS = 5 * 60_000;
const MAX_CHALLENGES = 10_000;
const challenges = new Map<string, number>(); // nonce -> expiry

/** The message for this wallet to sign. `publicUrl` is the server's own address (server.json). */
export function walletChallenge(publicUrl: string, address: string, chainId: number, now = Date.now()): string {
  for (const [nonce, expiry] of challenges) if (expiry < now) challenges.delete(nonce);
  if (challenges.size >= MAX_CHALLENGES) challenges.clear(); // asked for by anyone: bound the map
  const nonce = generateSiweNonce();
  challenges.set(nonce, now + CHALLENGE_MS);
  const url = new URL(publicUrl);
  return createSiweMessage({
    address: getAddress(address),
    chainId,
    domain: url.host,
    uri: url.origin,
    version: '1',
    nonce,
    statement: 'Log in to Aimparency.',
    issuedAt: new Date(now),
    expirationTime: new Date(now + CHALLENGE_MS)
  });
}

/** The address that signed `message`, or null. A message works once, and only one this server wrote for itself. */
export async function verifyWalletLogin(publicUrl: string, message: string, signature: string, now = Date.now()): Promise<string | null> {
  try {
    const parsed = parseSiweMessage(message);
    const expiry = parsed.nonce ? challenges.get(parsed.nonce) : undefined;
    if (parsed.nonce) challenges.delete(parsed.nonce);
    if (expiry === undefined || expiry < now) return null;
    if (parsed.domain !== new URL(publicUrl).host || !parsed.address) return null;
    if (parsed.expirationTime && parsed.expirationTime.getTime() < now) return null;
    return await verifyMessage({ address: parsed.address, message, signature: signature as Hex }) ? getAddress(parsed.address) : null;
  } catch {
    return null;
  }
}
