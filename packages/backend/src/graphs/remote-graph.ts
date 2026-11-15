// A graph added from a Git URL: its .bowman is cloned into the server
// directory, through the closed git environment of remote-git.ts. Without a
// key it only follows its remote (read-only here); with one of its owner's keys
// it is edited here, committed in the UI and pushed back.

import fs from 'fs-extra';
import path from 'node:path';
import { toBowmanPath } from 'shared';
import { READ_ONLY_MARKER } from 'shared/bowman-migration';
import { serverConfig } from 'shared/server-config';
import { cloneBowman } from '../git-repository-cache.js';
import { addRemoteGraph, graphBowmanPath, GraphError, setRemoteKey, type Graph } from './registry.js';
import { remoteGitEnv } from './remote-git.js';

// What was cloned from a stranger's URL must not fill the disk.
async function assertFitsLimit(directory: string) {
  const limit = serverConfig().limits.graphMegabytes;
  let bytes = 0;
  const measure = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await measure(file);
      else bytes += (await fs.lstat(file)).size;
    }
  };
  await measure(directory);
  if (bytes > limit * 1024 * 1024) {
    await fs.remove(directory);
    throw new Error(`This space is larger than the ${limit} MB a space may have on this server.`);
  }
}

/** `allowFileUrls`: tests clone from a directory; nothing a visitor enters gets that. */
export function addRemote(url: string, owner: string | null, options: { allowFileUrls?: boolean } = {}): Promise<Graph> {
  return addRemoteGraph(url, owner, async (directory) => {
    try {
      await cloneBowman(url, directory, await remoteGitEnv(url, null));
      await assertFitsLimit(directory);
    } catch (error) {
      throw new GraphError(error instanceof Error ? error.message : String(error));
    }
    await fs.ensureFile(path.join(toBowmanPath(directory), READ_ONLY_MARKER));
  }, options);
}

export async function selectRemoteKey(graph: Graph, key: { account: string; id: string } | null): Promise<void> {
  await setRemoteKey(graph.slug, key);
  const marker = path.join(graphBowmanPath(graph), READ_ONLY_MARKER);
  if (key) await fs.remove(marker);
  else await fs.ensureFile(marker);
}
