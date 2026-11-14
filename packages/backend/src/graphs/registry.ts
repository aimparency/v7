// The graphs of this server: graphs.json in the server directory. A graph is a
// git repository with a .bowman; the list says where it is, who owns it and who
// else may write it. Everyone may read every graph.
//
//   created   made on this server by an account: <server dir>/graphs/<slug>
//   remote    added from a Git URL by an account: its .bowman cloned into
//             <server dir>/remotes/<slug>. Read-only until its owner selects
//             an SSH key for it; then it is committed here and pushed back.
//   checkout  a repository on this machine that the server admin added
//
// The slug is the graph's name in addresses (/g/<slug>, and `graph` in
// the API). It is made once and stays when the graph is renamed.

import { execFile } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import { promisify } from 'node:util';
import { gitRepositoryLocation, isGraphSlug, toBowmanPath, toProjectRoot } from 'shared';
import { forgetServerFile, readServerFile, serverDir } from 'shared/server-config';
import { commitPaths, readWorkingTreeStatus } from '../git-working-tree.js';
import { withFileLock, writeJsonAtomic } from '../storage/json.js';
import { updateProjectMeta } from '../storage/project.js';

const execFileAsync = promisify(execFile);
const FILE = 'graphs.json';

export type Graph = {
  slug: string;
  kind: 'created' | 'remote' | 'checkout';
  /** Where a remote graph comes from, and the account's key that may push there. */
  remote?: { url: string; key?: { account: string; id: string } };
  /** The repository's directory on this server (it holds the .bowman). */
  path: string;
  /** Account id; null (or an account that is gone) leaves the graph to the server admins. */
  owner: string | null;
  /** Account ids that may change the graph, next to its owner. */
  writers: string[];
  /** Who may leave notes; absent: the server's default (server.json guestDefaults). */
  notes?: 'everyone' | 'selected' | 'nobody';
  /** With notes 'selected': the account ids that may. */
  noteWriters?: string[];
  createdAt: string;
};

export class GraphError extends Error {}

const MAX_SLUG_LENGTH = 40;

export function listGraphs(): Graph[] {
  return readServerFile(FILE, raw => ((raw ?? {}) as { graphs?: Graph[] }).graphs ?? []);
}

export function findGraph(slug: string): Graph | null {
  return listGraphs().find(graph => graph.slug === slug) ?? null;
}

/** The graph at this directory, given as the repository or its .bowman. */
export function findGraphByPath(directory: string): Graph | null {
  const root = toProjectRoot(path.resolve(directory));
  return listGraphs().find(graph => graph.path === root) ?? null;
}

export const graphBowmanPath = (graph: Graph) => toBowmanPath(graph.path);

async function change<T>(update: (graphs: Graph[]) => Promise<{ graphs: Graph[]; result: T }>): Promise<T> {
  const file = path.join(serverDir(), FILE);
  return withFileLock(file, async () => {
    forgetServerFile(FILE);
    const { graphs, result } = await update(listGraphs());
    await fs.ensureDir(path.dirname(file));
    await writeJsonAtomic(file, { graphs });
    forgetServerFile(FILE);
    return result;
  });
}

function freeSlug(name: string, graphs: Graph[]): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '') || 'graph';
  const taken = new Set(graphs.map(graph => graph.slug));
  if (!taken.has(base)) return base;
  for (let number = 2; ; number++) {
    if (!taken.has(`${base}-${number}`)) return `${base}-${number}`;
  }
}

/** A new, empty graph in a repository of its own on this server. */
export async function createGraph(name: string, owner: string | null): Promise<Graph> {
  const trimmed = name.trim();
  if (!trimmed) throw new GraphError('A graph needs a name.');
  if (trimmed.length > 100) throw new GraphError('A name has at most 100 characters.');
  return change(async (graphs) => {
    const slug = freeSlug(trimmed, graphs);
    const directory = path.join(serverDir(), 'graphs', slug);
    await fs.ensureDir(directory);
    await execFileAsync('git', ['init', '--quiet', directory]);
    await updateProjectMeta(directory, meta => ({ ...meta, name: trimmed }));
    // The graph starts as a commit, so its owner's first look shows nothing left to commit.
    const status = await readWorkingTreeStatus(directory);
    if (status.isRepository && status.changes.length) {
      await commitPaths(directory, status.changes.map(change => change.path), `Start the graph "${trimmed}"`);
    }
    const graph: Graph = { slug, kind: 'created', path: directory, owner, writers: [], createdAt: new Date().toISOString() };
    return { graphs: [...graphs, graph], result: graph };
  });
}

/**
 * A graph that lives in a repository elsewhere. `clone` fills the directory
 * (see routers/graphs.ts: it knows how to fetch a stranger's URL safely); a
 * failed clone leaves nothing on the list.
 */
export async function addRemoteGraph(
  url: string,
  owner: string | null,
  clone: (directory: string) => Promise<void>,
  { allowFileUrls = false } = {}
): Promise<Graph> {
  const location = gitRepositoryLocation(url, { allowFileUrls });
  if (!location) throw new GraphError(`Not a Git URL Aimparency can open: ${url}`);
  return change(async (graphs) => {
    if (graphs.some(graph => graph.remote?.url === url.trim())) throw new GraphError('This repository is a graph of this server already.');
    const slug = freeSlug(location[location.length - 1]!, graphs);
    const directory = path.join(serverDir(), 'remotes', slug);
    await clone(directory);
    const graph: Graph = {
      slug, kind: 'remote', path: directory, remote: { url: url.trim() }, owner, writers: [], createdAt: new Date().toISOString()
    };
    return { graphs: [...graphs, graph], result: graph };
  });
}

/** Selects the key a remote graph is pushed with, or none (then it is read-only). */
export async function setRemoteKey(slug: string, key: { account: string; id: string } | null): Promise<Graph> {
  return change(async (graphs) => {
    const graph = graphs.find(candidate => candidate.slug === slug);
    if (!graph?.remote) throw new GraphError(`"${slug}" is no graph from a remote URL.`);
    const next: Graph = { ...graph, remote: { url: graph.remote.url, ...(key ? { key } : {}) } };
    return { graphs: graphs.map(candidate => candidate.slug === slug ? next : candidate), result: next };
  });
}

/** Lists a repository that is already on this machine. The server admin's doing, never a visitor's. */
export async function addCheckout(directory: string, owner: string | null, slug?: string): Promise<Graph> {
  const root = toProjectRoot(path.resolve(directory));
  if (!(await fs.pathExists(root))) throw new GraphError(`No such directory: ${root}`);
  if (slug !== undefined && (!isGraphSlug(slug) || slug.length > MAX_SLUG_LENGTH)) {
    throw new GraphError('A slug has lower-case letters, digits and hyphens.');
  }
  return change(async (graphs) => {
    if (graphs.some(graph => graph.path === root)) throw new GraphError(`${root} is a graph of this server already.`);
    if (slug && graphs.some(graph => graph.slug === slug)) throw new GraphError(`"${slug}" exists already.`);
    const graph: Graph = {
      slug: slug ?? freeSlug(path.basename(root), graphs),
      kind: 'checkout', path: root, owner, writers: [], createdAt: new Date().toISOString()
    };
    return { graphs: [...graphs, graph], result: graph };
  });
}

/** Takes the graph off the list. A repository created or cloned here is deleted; a checkout stays where it is. */
export async function removeGraph(slug: string): Promise<void> {
  await change(async (graphs) => {
    const graph = graphs.find(candidate => candidate.slug === slug);
    if (!graph) throw new GraphError(`No graph "${slug}" on this server.`);
    if (graph.kind !== 'checkout') await fs.remove(graph.path);
    await fs.remove(path.join(serverDir(), 'guest', slug));
    return { graphs: graphs.filter(candidate => candidate.slug !== slug), result: undefined };
  });
}

export async function setGraphAccess(
  slug: string,
  access: { owner?: string | null; writers?: string[]; notes?: Graph['notes']; noteWriters?: string[] }
): Promise<Graph> {
  return change(async (graphs) => {
    const graph = graphs.find(candidate => candidate.slug === slug);
    if (!graph) throw new GraphError(`No graph "${slug}" on this server.`);
    const next = { ...graph, ...access };
    return { graphs: graphs.map(candidate => candidate.slug === slug ? next : candidate), result: next };
  });
}
