// The graphs of this server: graphs.json in the server directory. A graph is a
// git repository with a .bowman; the list says where it is, who owns it and who
// else may write it. Everyone may read every graph.
//
//   created   made on this server by an account: <server dir>/graphs/<slug>
//   checkout  a repository on this machine that the server admin added
//
// The slug is the graph's name in addresses (/g/<slug>, and `projectPath` in
// the API). It is made once and stays when the graph is renamed.

import { execFile } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import { promisify } from 'node:util';
import { isGraphSlug, toBowmanPath, toProjectRoot } from 'shared';
import { forgetServerFile, readServerFile, serverDir } from 'shared/server-config';
import { withFileLock, writeJsonAtomic } from '../storage/json.js';
import { updateProjectMeta } from '../storage/project.js';

const execFileAsync = promisify(execFile);
const FILE = 'graphs.json';

export type Graph = {
  slug: string;
  kind: 'created' | 'checkout';
  /** The repository's directory on this server (it holds the .bowman). */
  path: string;
  /** Account id; null (or an account that is gone) leaves the graph to the server admins. */
  owner: string | null;
  /** Account ids that may change the graph, next to its owner. */
  writers: string[];
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
    const graph: Graph = { slug, kind: 'created', path: directory, owner, writers: [], createdAt: new Date().toISOString() };
    return { graphs: [...graphs, graph], result: graph };
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

/** Takes the graph off the list. A repository created here is deleted; a checkout stays where it is. */
export async function removeGraph(slug: string): Promise<void> {
  await change(async (graphs) => {
    const graph = graphs.find(candidate => candidate.slug === slug);
    if (!graph) throw new GraphError(`No graph "${slug}" on this server.`);
    if (graph.kind === 'created') await fs.remove(graph.path);
    return { graphs: graphs.filter(candidate => candidate.slug !== slug), result: undefined };
  });
}

export async function setGraphAccess(slug: string, access: { owner?: string | null; writers?: string[] }): Promise<Graph> {
  return change(async (graphs) => {
    const graph = graphs.find(candidate => candidate.slug === slug);
    if (!graph) throw new GraphError(`No graph "${slug}" on this server.`);
    const next = { ...graph, ...access };
    return { graphs: graphs.map(candidate => candidate.slug === slug ? next : candidate), result: next };
  });
}
