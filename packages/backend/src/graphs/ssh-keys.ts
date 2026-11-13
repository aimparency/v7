// SSH keys an account keeps on this server, to push a graph to its remote. The
// server makes the pair and only ever shows the public half, which the account
// adds on the remote (on GitHub: a deploy key of that one repository, with
// write access). So a private key is never uploaded and never leaves the
// server, and what a break-in could reach are single repositories.
//
// <server dir>/keys/<account id>/<key id> and <key id>.pub; the label is the
// public key's comment.

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { promisify } from 'node:util';
import { serverDir } from 'shared/server-config';

const execFileAsync = promisify(execFile);
const ID = /^[0-9a-f]{12}$/;
const MAX_KEYS_PER_ACCOUNT = 20;

export class KeyError extends Error {}

export type PublicKey = { id: string; label: string; publicKey: string };

const directoryOf = (accountId: string) => path.join(serverDir(), 'keys', accountId);

async function readPublic(accountId: string, id: string): Promise<PublicKey> {
  const publicKey = (await fs.readFile(path.join(directoryOf(accountId), `${id}.pub`), 'utf8')).trim();
  return { id, publicKey, label: publicKey.split(' ').slice(2).join(' ') };
}

export async function listKeys(accountId: string): Promise<PublicKey[]> {
  const files = await fs.readdir(directoryOf(accountId)).catch(() => [] as string[]);
  return Promise.all(files.filter(file => file.endsWith('.pub')).sort().map(file => readPublic(accountId, file.slice(0, -4))));
}

export async function createKey(accountId: string, label: string): Promise<PublicKey> {
  const comment = label.trim().replace(/\s+/g, ' ').slice(0, 80) || 'aimparency';
  if ((await listKeys(accountId)).length >= MAX_KEYS_PER_ACCOUNT) throw new KeyError(`An account keeps at most ${MAX_KEYS_PER_ACCOUNT} keys.`);
  const directory = directoryOf(accountId);
  await fs.ensureDir(directory, { mode: 0o700 });
  const id = crypto.randomBytes(6).toString('hex');
  await execFileAsync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', path.join(directory, id)]);
  return readPublic(accountId, id);
}

/** The private key's file, for git's ssh only. Null when the account has no such key. */
export async function privateKeyFile(accountId: string, id: string): Promise<string | null> {
  if (!ID.test(id)) return null;
  const file = path.join(directoryOf(accountId), id);
  return await fs.pathExists(file) ? file : null;
}

export async function removeKey(accountId: string, id: string): Promise<void> {
  const file = await privateKeyFile(accountId, id);
  if (!file) throw new KeyError('No such key.');
  await fs.remove(file);
  await fs.remove(`${file}.pub`);
}
