// The spaces of this server: spaces.json in the server directory. A space is a
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
// A deleted space stays in the file, out of every lookup, for DELETED_DAYS:
// its owner may restore it until then; after, it is removed for good.
//
// The slug is the space's name in addresses (/spaces/<slug>, and `space` in
// the API). It stays when the space is renamed; its owner may change it, and
// the former slugs keep answering, so links and agents' tokens keep working.

import { execFile } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import { promisify } from 'node:util';
import { gitRepositoryLocation, isSpaceSlug, toBowmanPath, toProjectRoot } from 'shared';
import { forgetServerFile, readServerFile, serverDir, spacesDir } from 'shared/server-config';
import { commitPaths, readWorkingTreeStatus } from '../git-working-tree.js';
import { withFileLock, writeJsonAtomic } from '../storage/json.js';
import { updateProjectMeta } from '../storage/project.js';

const execFileAsync = promisify(execFile);
const FILE = 'spaces.json';

export type Space = {
  slug: string;
  kind: 'created' | 'remote' | 'checkout';
  /** Where a remote space comes from, and the account's key that may push there. */
  remote?: { url: string; key?: { account: string; id: string } };
  /** The repository's directory on this server (it holds the .bowman). */
  path: string;
  /** Account id; null (or an account that is gone) leaves the space to the server admins. */
  owner: string | null;
  /** Account ids that may change the space, next to its owner. */
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
  /** Slugs the space had before: they still lead here, and no other space takes them. */
  formerSlugs?: string[];
  createdAt: string;
  /** When its owner deleted it: hidden, restorable until DELETED_DAYS later. */
  deletedAt?: string;
};

export class SpaceError extends Error {}

const MAX_SLUG_LENGTH = 40;

export const DELETED_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/** Every space in the file, the deleted ones too. */
function allSpaces(): Space[] {
  return readServerFile(FILE, raw => ((raw ?? {}) as { spaces?: Space[] }).spaces ?? []);
}

/** The spaces of this server; a deleted one is none any more. */
export function listSpaces(): Space[] {
  return allSpaces().filter(space => !space.deletedAt);
}

/** The deleted spaces that may still be restored. */
export function listDeletedSpaces(): (Space & { deletedAt: string })[] {
  return allSpaces().filter((space): space is Space & { deletedAt: string } => !!space.deletedAt);
}

/** When a deleted space is removed for good. */
export const purgeDate = (space: Space & { deletedAt: string }) => new Date(Date.parse(space.deletedAt) + DELETED_DAYS * DAY);

export function findSpace(slug: string): Space | null {
  const spaces = listSpaces();
  return spaces.find(space => space.slug === slug) ?? spaces.find(space => space.formerSlugs?.includes(slug)) ?? null;
}

/** Every slug the space answers to: its own and its former ones. */
export const slugsOf = (space: Space) => [space.slug, ...(space.formerSlugs ?? [])];

/** The space at this directory, given as the repository or its .bowman. */
export function findSpaceByPath(directory: string): Space | null {
  const root = toProjectRoot(path.resolve(directory));
  return listSpaces().find(space => space.path === root) ?? null;
}

export const spaceBowmanPath = (space: Space) => toBowmanPath(space.path);

async function change<T>(update: (spaces: Space[]) => Promise<{ spaces: Space[]; result: T }>): Promise<T> {
  const file = path.join(serverDir(), FILE);
  return withFileLock(file, async () => {
    forgetServerFile(FILE);
    const { spaces, result } = await update(allSpaces());
    await fs.ensureDir(path.dirname(file));
    await writeJsonAtomic(file, { spaces });
    forgetServerFile(FILE);
    return result;
  });
}

function freeSlug(name: string, spaces: Space[]): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '') || 'space';
  const taken = new Set(spaces.flatMap(slugsOf));
  if (!taken.has(base)) return base;
  for (let number = 2; ; number++) {
    if (!taken.has(`${base}-${number}`)) return `${base}-${number}`;
  }
}

// The space starts as a commit, so its owner's first look shows nothing left to commit.
async function commitStart(directory: string, name: string) {
  const status = await readWorkingTreeStatus(directory);
  if (status.isRepository && status.changes.length) {
    await commitPaths(directory, status.changes.map(change => change.path), `Start the space "${name}"`);
  }
}

/**
 * A fresh spin-off at this repository root joins the server's spaces. In the
 * spaces directory it is a space of the server, in a repository of its own;
 * elsewhere a checkout, its repository left as it is.
 */
export async function addSpinOff(root: string, name: string): Promise<Space> {
  const created = path.dirname(root) === spacesDir();
  if (created && !(await readWorkingTreeStatus(root)).isRepository) {
    await execFileAsync('git', ['init', '--quiet', root]);
    await commitStart(root, name);
  }
  return change(async (spaces) => {
    const listed = spaces.find(space => space.path === root && !space.deletedAt);
    if (listed) return { spaces, result: listed };
    const space: Space = {
      slug: freeSlug(path.basename(root), spaces), kind: created ? 'created' : 'checkout',
      path: root, owner: null, writers: [], createdAt: new Date().toISOString()
    };
    return { spaces: [...spaces, space], result: space };
  });
}

/** A new, empty space in a repository of its own on this server. */
export async function createSpace(name: string, owner: string | null): Promise<Space> {
  const trimmed = name.trim();
  if (!trimmed) throw new SpaceError('A space needs a name.');
  if (trimmed.length > 100) throw new SpaceError('A name has at most 100 characters.');
  return change(async (spaces) => {
    const slug = freeSlug(trimmed, spaces);
    const directory = path.join(spacesDir(), slug);
    await fs.ensureDir(directory);
    await execFileAsync('git', ['init', '--quiet', directory]);
    await updateProjectMeta(directory, meta => ({ ...meta, name: trimmed }));
    await commitStart(directory, trimmed);
    const space: Space = { slug, kind: 'created', path: directory, owner, writers: [], createdAt: new Date().toISOString() };
    return { spaces: [...spaces, space], result: space };
  });
}

/**
 * A space that lives in a repository elsewhere. `clone` fills the directory
 * (see routers/spaces.ts: it knows how to fetch a stranger's URL safely); a
 * failed clone leaves nothing on the list.
 */
export async function addRemoteSpace(
  url: string,
  owner: string | null,
  clone: (directory: string) => Promise<void>,
  { allowFileUrls = false, key }: { allowFileUrls?: boolean; key?: { account: string; id: string } } = {}
): Promise<Space> {
  const location = gitRepositoryLocation(url, { allowFileUrls });
  if (!location) throw new SpaceError(`Not a Git URL Aimparency can open: ${url}`);
  return change(async (spaces) => {
    if (spaces.some(space => space.remote?.url === url.trim())) throw new SpaceError('This repository is a space of this server already.');
    const slug = freeSlug(location[location.length - 1]!, spaces);
    const directory = path.join(serverDir(), 'remotes', slug);
    await clone(directory);
    const space: Space = {
      slug, kind: 'remote', path: directory, remote: { url: url.trim(), ...(key ? { key } : {}) }, owner, writers: [], createdAt: new Date().toISOString()
    };
    return { spaces: [...spaces, space], result: space };
  });
}

/**
 * What an invitation to a space gives the account that takes it: write access
 * (it then reads too) or a place among the readers. Its owner gets nothing more.
 */
export async function grantAccess(slug: string, accountId: string, right: 'read' | 'write' | 'manage'): Promise<Space> {
  return change(async (spaces) => {
    const space = spaces.find(candidate => !candidate.deletedAt && slugsOf(candidate).includes(slug));
    if (!space) throw new SpaceError('The space of this invitation is gone.');
    if (space.owner === accountId) return { spaces, result: space };
    const next: Space = right === 'manage'
      ? { ...space, managers: [...new Set([...(space.managers ?? []), accountId])] }
      : right === 'write'
        ? { ...space, writers: [...new Set([...space.writers, accountId])] }
        : { ...space, readers: [...new Set([...(space.readers ?? []), accountId])] };
    return { spaces: spaces.map(candidate => candidate === space ? next : candidate), result: next };
  });
}

/** Selects the key a remote space is pushed with, or none (then it is read-only). */
export async function setRemoteKey(slug: string, key: { account: string; id: string } | null): Promise<Space> {
  return change(async (spaces) => {
    const space = spaces.find(candidate => candidate.slug === slug);
    if (!space?.remote) throw new SpaceError(`"${slug}" is no space from a remote URL.`);
    const next: Space = { ...space, remote: { url: space.remote.url, ...(key ? { key } : {}) } };
    return { spaces: spaces.map(candidate => candidate.slug === slug ? next : candidate), result: next };
  });
}

/** Lists a repository that is already on this machine. The server admin's doing, never a visitor's. */
export async function addCheckout(directory: string, owner: string | null, slug?: string): Promise<Space> {
  const root = toProjectRoot(path.resolve(directory));
  if (!(await fs.pathExists(root))) throw new SpaceError(`No such directory: ${root}`);
  if (slug !== undefined && (!isSpaceSlug(slug) || slug.length > MAX_SLUG_LENGTH)) {
    throw new SpaceError('A slug has lower-case letters, digits and hyphens.');
  }
  return change(async (spaces) => {
    if (spaces.some(space => space.path === root)) throw new SpaceError(`${root} is a space of this server already.`);
    if (slug && spaces.some(space => slugsOf(space).includes(slug))) throw new SpaceError(`"${slug}" exists already.`);
    const space: Space = {
      slug: slug ?? freeSlug(path.basename(root), spaces),
      kind: 'checkout', path: root, owner, writers: [], createdAt: new Date().toISOString()
    };
    return { spaces: [...spaces, space], result: space };
  });
}

/**
 * Gives the space a new slug. The old one is kept as a former slug, so it still
 * leads here; a former slug of the same space may be taken back.
 */
export async function setSpaceSlug(slug: string, next: string): Promise<Space> {
  if (!isSpaceSlug(next) || next.length > MAX_SLUG_LENGTH) {
    throw new SpaceError(`An address has lower-case letters, digits and hyphens, at most ${MAX_SLUG_LENGTH}.`);
  }
  return change(async (spaces) => {
    const space = spaces.find(candidate => candidate.slug === slug);
    if (!space) throw new SpaceError(`No space "${slug}" on this server.`);
    if (next === space.slug) return { spaces, result: space };
    if (spaces.some(other => other !== space && slugsOf(other).includes(next))) throw new SpaceError(`"${next}" is taken.`);
    const guest = path.join(serverDir(), 'guest');
    if (await fs.pathExists(path.join(guest, slug))) await fs.move(path.join(guest, slug), path.join(guest, next), { overwrite: true });
    const formerSlugs = [...new Set([...(space.formerSlugs ?? []), slug])].filter(former => former !== next);
    const renamed: Space = { ...space, slug: next, formerSlugs };
    return { spaces: spaces.map(candidate => candidate === space ? renamed : candidate), result: renamed };
  });
}

// What removing a space deletes depends on where it came from: a space created
// here is its repository, so the repository goes; of a remote space only the
// clone here goes, never the remote; a checkout is the operator's repository
// and stays where it is: only the server's entry and its guests' notes go.
const ownDirectory = (kind: Space['kind']): string | null =>
  kind === 'created' ? spacesDir() : kind === 'remote' ? path.join(serverDir(), 'remotes') : null;

async function removeFiles(space: Space) {
  // Only ever a directory the server made itself, whatever spaces.json says.
  const parent = ownDirectory(space.kind);
  if (parent) {
    const relative = path.relative(parent, path.resolve(space.path));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new SpaceError(`"${space.slug}" points outside ${parent}: its directory is left alone.`);
    }
    // A background write into the space (the search warm-up, a pull) may still
    // be filling a directory as it goes: retry instead of failing on ENOTEMPTY.
    await fs.promises.rm(space.path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
  await fs.remove(path.join(serverDir(), 'guest', space.slug));
}

/**
 * Takes the space off the list at once and for good. A repository created or
 * cloned here is deleted; a checkout stays where it is. Deleted spaces too.
 */
export async function removeSpaceEntry(slug: string): Promise<void> {
  await change(async (spaces) => {
    const space = spaces.find(candidate => candidate.slug === slug);
    if (!space) throw new SpaceError(`No space "${slug}" on this server.`);
    await removeFiles(space);
    return { spaces: spaces.filter(candidate => candidate !== space), result: undefined };
  });
}

/** Deletes the space so its owner may still restore it for DELETED_DAYS. */
export async function deleteSpaceEntry(slug: string, now = Date.now()): Promise<void> {
  await change(async (spaces) => {
    const space = spaces.find(candidate => candidate.slug === slug && !candidate.deletedAt);
    if (!space) throw new SpaceError(`No space "${slug}" on this server.`);
    const deleted: Space = { ...space, deletedAt: new Date(now).toISOString() };
    return { spaces: spaces.map(candidate => candidate === space ? deleted : candidate), result: undefined };
  });
}

export async function restoreSpace(slug: string): Promise<Space> {
  return change(async (spaces) => {
    const space = spaces.find(candidate => candidate.slug === slug && candidate.deletedAt);
    if (!space) throw new SpaceError(`No deleted space "${slug}" on this server.`);
    const { deletedAt: _deletedAt, ...restored } = space;
    return { spaces: spaces.map(candidate => candidate === space ? restored : candidate), result: restored };
  });
}

export async function setSpaceAccess(
  slug: string,
  access: { owner?: string | null; writers?: string[]; managers?: string[]; notes?: Space['notes']; noteWriters?: string[]; read?: Space['read']; readers?: string[] }
): Promise<Space> {
  return change(async (spaces) => {
    const space = spaces.find(candidate => candidate.slug === slug);
    if (!space) throw new SpaceError(`No space "${slug}" on this server.`);
    const next = { ...space, ...access };
    return { spaces: spaces.map(candidate => candidate.slug === slug ? next : candidate), result: next };
  });
}
