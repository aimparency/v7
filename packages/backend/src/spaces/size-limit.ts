// How large a space may grow on a server with accounts (server.json
// limits.spaceMegabytes): a space cloned from a URL is measured once, one
// created here is measured as people write to it.

import fs from 'fs-extra';
import path from 'node:path';
import { serverConfig } from 'shared/server-config';
import { spaceBowmanPath, type Space } from './registry.js';

export async function directoryBytes(directory: string, skip: string[] = []): Promise<number> {
  let bytes = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (skip.includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    bytes += entry.isDirectory() ? await directoryBytes(file) : (await fs.lstat(file)).size;
  }
  return bytes;
}

export const spaceLimitBytes = () => serverConfig().limits.spaceMegabytes * 1024 * 1024;

export class SpaceTooLargeError extends Error {
  constructor() {
    super(`This space is larger than the ${serverConfig().limits.spaceMegabytes} MB a space may have on this server.`);
  }
}

/**
 * Refuses a change to a space whose ideas and phases have outgrown the limit,
 * measured before each change. The server's own cache and runtime state
 * (gitignored, rebuilt as needed) do not count. Removing (delete…, remove…) stays possible:
 * that is how it gets small again.
 */
export async function assertSpaceMayGrow(space: Space, procedurePath: string): Promise<void> {
  if (/^(delete|remove)/i.test(procedurePath.slice(procedurePath.lastIndexOf('.') + 1))) return;
  if (await directoryBytes(spaceBowmanPath(space), ['cache', 'runtime']) > spaceLimitBytes()) throw new SpaceTooLargeError();
}
