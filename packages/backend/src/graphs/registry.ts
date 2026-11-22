// The graphs of this server: graphs.json in the server directory. A graph is a
// git repository with a .bowman; the list says where it is, who owns it, who
// else may write it and who may read it (auth/access.ts mayRead).
//
//   created   made on this server by an account, or spun off into the spaces
//             directory: <spaces dir>/<slug> (server.json spacesDir)
//   remote    added from a Git URL by an account: its .bowman cloned into
//             <server dir>/remotes/<slug>. Read-only until its owner selects
//             an SSH key for it; then it is committed here and pushed back.
//   checkout  a repository on this machine that the server admin added
//
// A deleted graph stays in the file, out of every lookup, for DELETED_DAYS:
// its owner may restore it until then; after, it is removed for good.
//
// The slug is the graph's name in addresses (/spaces/<slug>, and `graph` in
// the API). It stays when the graph is renamed; its owner may change it, and
// the former slugs keep answering, so links and agents' tokens keep working.

import { execFile } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import { promisify } from 'node:util';
import { gitRepositoryLocation, isGraphSlug, toBowmanPath, toProjectRoot } from 'shared';
import { forgetServerFile, readServerFile, serverDir, spacesDir } from 'shared/server-config';
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
  /** Account ids that change it and also choose who else reads and writes it (not who manages it). */
  managers?: string[];
  /** Who may leave notes; absent: the server's default (server.json guestDefaults). */
  notes?: 'everyone' | 'selected' | 'nobody';
  /** With notes 'selected': the account ids that may. */
  noteWriters?: string[];
  /** Who may read it besides its owner and writers; absent: the server's default (server.json guestDefaults.read). */
  read?: 'everyone' | 'accounts' | 'selected';
  /** With read 'selected': the account ids that may. */
  readers?: string[];
  /** Slugs the graph had before: they still lead here, and no other graph takes them. */
  formerSlugs?: string[];
  createdAt: string;
  /** When its owner deleted it: hidden, restorable until DELETED_DAYS later. */
  deletedAt?: string;
};

export class GraphError extends Error {}

const MAX_SLUG_LENGTH = 40;

export const DELETED_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/** Every graph in the file, the deleted ones too. */
function allGraphs(): Graph[] {
  return readServerFile(FILE, raw => ((raw ?? {}) as { graphs?: Graph[] }).graphs ?? []);
}

/** The graphs of this server; a deleted one is none any more. */
export function listGraphs(): Graph[] {
  return allGraphs().filter(graph => !graph.deletedAt);
}

/** The deleted graphs that may still be restored. */
export function listDeletedGraphs(): (Graph & { deletedAt: string })[] {
  return allGraphs().filter((graph): graph is Graph & { deletedAt: string } => !!graph.deletedAt);
}

/** When a deleted graph is removed for good. */
export const purgeDate = (graph: Graph & { deletedAt: string }) => new Date(Date.parse(graph.deletedAt) + DELETED_DAYS * DAY);

export function findGraph(slug: string): Graph | null {
  const graphs = listGraphs();
  return graphs.find(graph => graph.slug === slug) ?? graphs.find(graph => graph.formerSlugs?.includes(slug)) ?? null;
}

/** Every slug the graph answers to: its own and its former ones. */
export const slugsOf = (graph: Graph) => [graph.slug, ...(graph.formerSlugs ?? [])];

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
    const { graphs, result } = await update(allGraphs());
    await fs.ensureDir(path.dirname(file));
    await writeJsonAtomic(file, { graphs });
    forgetServerFile(FILE);
    return result;
  });
}

function freeSlug(name: string, graphs: Graph[]): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '') || 'graph';
  const taken = new Set(graphs.flatMap(slugsOf));
  if (!taken.has(base)) return base;
  for (let number = 2; ; number++) {
    if (!taken.has(`${base}-${number}`)) return `${base}-${number}`;
  }
}

// The graph starts as a commit, so its owner's first look shows nothing left to commit.
async function commitStart(directory: string, name: string) {
  const status = await readWorkingTreeStatus(directory);
  if (status.isRepository && status.changes.length) {
    await commitPaths(directory, status.changes.map(change => change.path), `Start the graph "${name}"`);
  }
}

/**
 * A fresh spin-off at this repository root joins the server's spaces. In the
 * spaces directory it is a space of the server, in a repository of its own;
 * elsewhere a checkout, its repository left as it is.
 */
export async function addSpinOff(root: string, name: string): Promise<Graph> {
  const created = path.dirname(root) === spacesDir();
  if (created && !(await readWorkingTreeStatus(root)).isRepository) {
    await execFileAsync('git', ['init', '--quiet', root]);
    await commitStart(root, name);
  }
  return change(async (graphs) => {
    const listed = graphs.find(graph => graph.path === root && !graph.deletedAt);
    if (listed) return { graphs, result: listed };
    const graph: Graph = {
      slug: freeSlug(path.basename(root), graphs), kind: created ? 'created' : 'checkout',
      path: root, owner: null, writers: [], createdAt: new Date().toISOString()
    };
    return { graphs: [...graphs, graph], result: graph };
  });
}

/** A new, empty graph in a repository of its own on this server. */
export async function createGraph(name: string, owner: string | null): Promise<Graph> {
  const trimmed = name.trim();
  if (!trimmed) throw new GraphError('A space needs a name.');
  if (trimmed.length > 100) throw new GraphError('A name has at most 100 characters.');
  return change(async (graphs) => {
    const slug = freeSlug(trimmed, graphs);
    const directory = path.join(spacesDir(), slug);
    await fs.ensureDir(directory);
    await execFileAsync('git', ['init', '--quiet', directory]);
    await updateProjectMeta(directory, meta => ({ ...meta, name: trimmed }));
    await commitStart(directory, trimmed);
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
  { allowFileUrls = false, key }: { allowFileUrls?: boolean; key?: { account: string; id: string } } = {}
): Promise<Graph> {
  const location = gitRepositoryLocation(url, { allowFileUrls });
  if (!location) throw new GraphError(`Not a Git URL Aimparency can open: ${url}`);
  return change(async (graphs) => {
    if (graphs.some(graph => graph.remote?.url === url.trim())) throw new GraphError('This repository is a space of this server already.');
    const slug = freeSlug(location[location.length - 1]!, graphs);
    const directory = path.join(serverDir(), 'remotes', slug);
    await clone(directory);
    const graph: Graph = {
      slug, kind: 'remote', path: directory, remote: { url: url.trim(), ...(key ? { key } : {}) }, owner, writers: [], createdAt: new Date().toISOString()
    };
    return { graphs: [...graphs, graph], result: graph };
  });
}

/**
 * What an invitation to a space gives the account that takes it: write access
 * (it then reads too) or a place among the readers. Its owner gets nothing more.
 */
export async function grantAccess(slug: string, accountId: string, right: 'read' | 'write' | 'manage'): Promise<Graph> {
  return change(async (graphs) => {
    const graph = graphs.find(candidate => !candidate.deletedAt && slugsOf(candidate).includes(slug));
    if (!graph) throw new GraphError('The space of this invitation is gone.');
    if (graph.owner === accountId) return { graphs, result: graph };
    const next: Graph = right === 'manage'
      ? { ...graph, managers: [...new Set([...(graph.managers ?? []), accountId])] }
      : right === 'write'
        ? { ...graph, writers: [...new Set([...graph.writers, accountId])] }
        : { ...graph, readers: [...new Set([...(graph.readers ?? []), accountId])] };
    return { graphs: graphs.map(candidate => candidate === graph ? next : candidate), result: next };
  });
}

/** Selects the key a remote graph is pushed with, or none (then it is read-only). */
export async function setRemoteKey(slug: string, key: { account: string; id: string } | null): Promise<Graph> {
  return change(async (graphs) => {
    const graph = graphs.find(candidate => candidate.slug === slug);
    if (!graph?.remote) throw new GraphError(`"${slug}" is no space from a remote URL.`);
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
    if (graphs.some(graph => graph.path === root)) throw new GraphError(`${root} is a space of this server already.`);
    if (slug && graphs.some(graph => slugsOf(graph).includes(slug))) throw new GraphError(`"${slug}" exists already.`);
    const graph: Graph = {
      slug: slug ?? freeSlug(path.basename(root), graphs),
      kind: 'checkout', path: root, owner, writers: [], createdAt: new Date().toISOString()
    };
    return { graphs: [...graphs, graph], result: graph };
  });
}

/**
 * Gives the graph a new slug. The old one is kept as a former slug, so it still
 * leads here; a former slug of the same graph may be taken back.
 */
export async function setGraphSlug(slug: string, next: string): Promise<Graph> {
  if (!isGraphSlug(next) || next.length > MAX_SLUG_LENGTH) {
    throw new GraphError(`An address has lower-case letters, digits and hyphens, at most ${MAX_SLUG_LENGTH}.`);
  }
  return change(async (graphs) => {
    const graph = graphs.find(candidate => candidate.slug === slug);
    if (!graph) throw new GraphError(`No space "${slug}" on this server.`);
    if (next === graph.slug) return { graphs, result: graph };
    if (graphs.some(other => other !== graph && slugsOf(other).includes(next))) throw new GraphError(`"${next}" is taken.`);
    const guest = path.join(serverDir(), 'guest');
    if (await fs.pathExists(path.join(guest, slug))) await fs.move(path.join(guest, slug), path.join(guest, next), { overwrite: true });
    const formerSlugs = [...new Set([...(graph.formerSlugs ?? []), slug])].filter(former => former !== next);
    const renamed: Graph = { ...graph, slug: next, formerSlugs };
    return { graphs: graphs.map(candidate => candidate === graph ? renamed : candidate), result: renamed };
  });
}

// What removing a graph deletes depends on where it came from: a graph created
// here is its repository, so the repository goes; of a remote graph only the
// clone here goes, never the remote; a checkout is the operator's repository
// and stays where it is: only the server's entry and its guests' notes go.
const ownDirectory = (kind: Graph['kind']): string | null =>
  kind === 'created' ? spacesDir() : kind === 'remote' ? path.join(serverDir(), 'remotes') : null;

async function removeFiles(graph: Graph) {
  // Only ever a directory the server made itself, whatever graphs.json says.
  const parent = ownDirectory(graph.kind);
  if (parent) {
    const relative = path.relative(parent, path.resolve(graph.path));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new GraphError(`"${graph.slug}" points outside ${parent}: its directory is left alone.`);
    }
    // A background write into the graph (the search warm-up, a pull) may still
    // be filling a directory as it goes: retry instead of failing on ENOTEMPTY.
    await fs.promises.rm(graph.path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
  await fs.remove(path.join(serverDir(), 'guest', graph.slug));
}

/**
 * Takes the graph off the list at once and for good. A repository created or
 * cloned here is deleted; a checkout stays where it is. Deleted graphs too.
 */
export async function removeGraph(slug: string): Promise<void> {
  await change(async (graphs) => {
    const graph = graphs.find(candidate => candidate.slug === slug);
    if (!graph) throw new GraphError(`No space "${slug}" on this server.`);
    await removeFiles(graph);
    return { graphs: graphs.filter(candidate => candidate !== graph), result: undefined };
  });
}

/** Deletes the graph so its owner may still restore it for DELETED_DAYS. */
export async function deleteGraph(slug: string, now = Date.now()): Promise<void> {
  await change(async (graphs) => {
    const graph = graphs.find(candidate => candidate.slug === slug && !candidate.deletedAt);
    if (!graph) throw new GraphError(`No space "${slug}" on this server.`);
    const deleted: Graph = { ...graph, deletedAt: new Date(now).toISOString() };
    return { graphs: graphs.map(candidate => candidate === graph ? deleted : candidate), result: undefined };
  });
}

export async function restoreGraph(slug: string): Promise<Graph> {
  return change(async (graphs) => {
    const graph = graphs.find(candidate => candidate.slug === slug && candidate.deletedAt);
    if (!graph) throw new GraphError(`No deleted space "${slug}" on this server.`);
    const { deletedAt: _deletedAt, ...restored } = graph;
    return { graphs: graphs.map(candidate => candidate === graph ? restored : candidate), result: restored };
  });
}

export async function setGraphAccess(
  slug: string,
  access: { owner?: string | null; writers?: string[]; managers?: string[]; notes?: Graph['notes']; noteWriters?: string[]; read?: Graph['read']; readers?: string[] }
): Promise<Graph> {
  return change(async (graphs) => {
    const graph = graphs.find(candidate => candidate.slug === slug);
    if (!graph) throw new GraphError(`No space "${slug}" on this server.`);
    const next = { ...graph, ...access };
    return { graphs: graphs.map(candidate => candidate.slug === slug ? next : candidate), result: next };
  });
}
