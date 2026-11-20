// A graph added from a Git URL: its .bowman is cloned into the server
// directory, through the closed git environment of remote-git.ts. Without a
// key it only follows its remote (read-only here); with one of its owner's keys
// it is edited here, committed in the UI and pushed back.

import { execFile } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import { promisify } from 'node:util';
import { toBowmanPath } from 'shared';
import { READ_ONLY_MARKER } from 'shared/bowman-migration';
import { serverConfig } from 'shared/server-config';
import { cloneBowman } from '../git-repository-cache.js';
import { commitPaths, pushToUpstream, readWorkingTreeStatus } from '../git-working-tree.js';
import { updateProjectMeta } from '../storage/project.js';
import { addRemoteGraph, graphBowmanPath, GraphError, setRemoteKey, type Graph } from './registry.js';
import { graphGitEnv, remoteGitEnv } from './remote-git.js';
import { privateKeyFile } from './ssh-keys.js';

const execFileAsync = promisify(execFile);

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

/**
 * A key works over SSH only: an https address of a repository becomes its SSH
 * address (git@host:owner/repo.git), as GitHub and the like offer it.
 */
export function sshUrlOf(url: string): string {
  const trimmed = url.trim();
  if (!/^https?:\/\//.test(trimmed)) return trimmed;
  const parsed = new URL(trimmed);
  const repository = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  return `git@${parsed.hostname}:${repository}.git`;
}

export type AddedRemote = Graph & {
  /** The repository had no .bowman: the space was started in it and committed. */
  started?: boolean;
  /** Why pushing that start failed (e.g. a deploy key without write access); it waits to be pushed. */
  pushError?: string;
};

/**
 * `key`: one of the owner's keys (a deploy key of the repository): the clone
 * is made with it, so a private repository works, and the space is edited here
 * and pushed back from the start. With a key a repository without a .bowman
 * becomes a new space in it.
 * `allowFileUrls`: tests clone from a directory; nothing a visitor enters gets that.
 */
export async function addRemote(
  url: string,
  owner: string | null,
  options: { allowFileUrls?: boolean; key?: { account: string; id: string } } = {}
): Promise<AddedRemote> {
  const key = options.key;
  const keyFile = key ? await privateKeyFile(key.account, key.id) : null;
  if (key && !keyFile) throw new GraphError('Select one of your own keys.');
  const remoteUrl = key ? sshUrlOf(url) : url;
  let started = false;
  const graph: AddedRemote = await addRemoteGraph(remoteUrl, owner, async (directory) => {
    try {
      await cloneBowman(remoteUrl, directory, await remoteGitEnv(remoteUrl, keyFile), { allowMissing: !!key });
      await assertFitsLimit(directory);
    } catch (error) {
      throw new GraphError(error instanceof Error ? error.message : String(error));
    }
    if (!key) {
      await fs.ensureFile(path.join(toBowmanPath(directory), READ_ONLY_MARKER));
      return;
    }
    if (!(await fs.pathExists(toBowmanPath(directory)))) {
      const name = path.basename(remoteUrl.replace(/\.git$/, '').replace(/[:/]+$/, '').split(/[:/]/).pop() ?? 'space');
      await updateProjectMeta(directory, meta => ({ ...meta, name }));
      const status = await readWorkingTreeStatus(toBowmanPath(directory));
      if (status.isRepository && status.changes.length) {
        await commitPaths(toBowmanPath(directory), status.changes.map(change => change.path), 'Start the Aimparency space');
      }
      started = true;
    }
  }, options);
  if (!started) return graph;
  // An empty repository has no branch to follow yet: the first push makes it.
  try {
    const env = await graphGitEnv(graph);
    const status = await readWorkingTreeStatus(graphBowmanPath(graph));
    if (status.isRepository && status.ahead === null) {
      await execGit(['-C', graph.path, 'push', '--quiet', '-u', 'origin', 'HEAD'], env);
    } else {
      await pushToUpstream(graphBowmanPath(graph), env);
    }
    return { ...graph, started };
  } catch (error) {
    return { ...graph, started, pushError: error instanceof Error ? error.message : String(error) };
  }
}

async function execGit(args: string[], env: NodeJS.ProcessEnv) {
  try {
    await execFileAsync('git', args, { env, timeout: 120_000 });
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? '');
    throw new Error(stderr.split('\n').find(line => line.trim())?.replace(/^(fatal|error): /, '') ?? 'Push failed');
  }
}

export async function selectRemoteKey(graph: Graph, key: { account: string; id: string } | null): Promise<void> {
  await setRemoteKey(graph.slug, key);
  const marker = path.join(graphBowmanPath(graph), READ_ONLY_MARKER);
  if (key) await fs.remove(marker);
  else await fs.ensureFile(marker);
}
