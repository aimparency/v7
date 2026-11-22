// How large a space may grow on a server with accounts (server.json
// limits.graphMegabytes): a graph cloned from a URL is measured once, one
// created here is measured as people write to it.

import fs from 'fs-extra';
import path from 'node:path';
import { serverConfig } from 'shared/server-config';
import { graphBowmanPath, type Graph } from './registry.js';

export async function directoryBytes(directory: string, skip: string[] = []): Promise<number> {
  let bytes = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (skip.includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    bytes += entry.isDirectory() ? await directoryBytes(file) : (await fs.lstat(file)).size;
  }
  return bytes;
}

export const graphLimitBytes = () => serverConfig().limits.graphMegabytes * 1024 * 1024;

export class GraphTooLargeError extends Error {
  constructor() {
    super(`This space is larger than the ${serverConfig().limits.graphMegabytes} MB a space may have on this server.`);
  }
}

/**
 * Refuses a change to a space whose ideas and phases have outgrown the limit,
 * measured before each change. The server's own cache and runtime state
 * (gitignored, rebuilt as needed) do not count. Removing (delete…, remove…) stays possible:
 * that is how it gets small again.
 */
export async function assertGraphMayGrow(graph: Graph, procedurePath: string): Promise<void> {
  if (/^(delete|remove)/i.test(procedurePath.split('.').at(-1) ?? '')) return;
  if (await directoryBytes(graphBowmanPath(graph), ['cache', 'runtime']) > graphLimitBytes()) throw new GraphTooLargeError();
}
