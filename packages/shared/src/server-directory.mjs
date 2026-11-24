// Where a server of this machine keeps what it owns. Plain JavaScript, so the
// launcher (scripts/run-local-stack.mjs, run by node) resolves it the same way
// as the backend and the CLIs (through server-config.ts).
//
//   ~/.local/share/aimparency/<name>/   (XDG_DATA_HOME respected)
//
// AIMPARENCY_SERVER_DIR gives a directory directly. Servers used to live in
// ~/.local/share/aimparency-<name>, with their created spaces in graphs/: such
// a directory is moved here once, its graphs/ becoming spaces/, and the paths in
// its graphs.json follow.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_SERVER_NAME = 'local';

const moved = new Set();

/** @returns {string} */
export function serverDirectory() {
  const directory = locateServerDirectory();
  if (!moved.has(directory)) {
    renameGraphsToSpaces(directory);
    moved.add(directory);
  }
  return directory;
}

function locateServerDirectory() {
  if (process.env.AIMPARENCY_SERVER_DIR) return path.resolve(process.env.AIMPARENCY_SERVER_DIR);
  const name = process.env.AIMPARENCY_SERVER || DEFAULT_SERVER_NAME;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`A server name has lower-case letters, digits and hyphens: "${name}"`);
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const directory = path.join(dataHome, 'aimparency', name);
  const legacy = path.join(dataHome, `aimparency-${name}`);
  if (!moved.has(legacy)) {
    moveLegacyServerDirectory(legacy, directory);
    moved.add(legacy);
  }
  return directory;
}

/** @param {string} file @param {(content: any) => boolean} change */
function rewriteJson(file, change) {
  if (!fs.existsSync(file)) return;
  const content = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (change(content)) fs.writeFileSync(file, JSON.stringify(content, null, 2) + '\n');
}

/** @param {any} object @param {string} from @param {string} to */
function renameKey(object, from, to) {
  if (!object || typeof object !== 'object' || !(from in object)) return false;
  if (!(to in object)) object[to] = object[from];
  delete object[from];
  return true;
}

/**
 * 2026-11: what the server files called graphs are spaces. Renames the
 * stored names once; idempotent, so a server that already has them is untouched.
 * @param {string} directory
 */
export function renameGraphsToSpaces(directory) {
  if (!fs.existsSync(directory)) return;
  const graphs = path.join(directory, 'graphs.json');
  const spaces = path.join(directory, 'spaces.json');
  if (fs.existsSync(graphs) && !fs.existsSync(spaces)) {
    const content = JSON.parse(fs.readFileSync(graphs, 'utf8'));
    renameKey(content, 'graphs', 'spaces');
    fs.writeFileSync(spaces, JSON.stringify(content, null, 2) + '\n');
    fs.rmSync(graphs);
  }
  rewriteJson(path.join(directory, 'server.json'), (config) => {
    const changed = [renameKey(config, 'graphCreation', 'spaceCreation'),
      renameKey(config.limits, 'graphsPerAccount', 'spacesPerAccount'), renameKey(config.limits, 'graphMegabytes', 'spaceMegabytes')];
    return changed.some(Boolean);
  });
  rewriteJson(path.join(directory, 'accounts.json'), (content) => {
    const changed = [
      ...(content.accounts ?? []).map((/** @type {any} */ account) => renameKey(account, 'canCreateGraphs', 'canCreateSpaces')),
      ...(content.invitations ?? []).map((/** @type {any} */ invitation) => renameKey(invitation, 'canCreateGraphs', 'canCreateSpaces')),
      ...(content.tokens ?? []).map((/** @type {any} */ token) => renameKey(token, 'graphs', 'spaces'))
    ];
    return changed.some(Boolean);
  });
  const guest = path.join(directory, 'guest');
  if (!fs.existsSync(guest)) return;
  for (const slug of fs.readdirSync(guest)) {
    // An offer named the space it offers `space`; now `offeredSpace`.
    rewriteJson(path.join(guest, slug, 'notes.json'), (content) =>
      (content.notes ?? []).map((/** @type {any} */ note) => renameKey(note, 'space', 'offeredSpace')).some(Boolean));
  }
}

/** Idempotent: does nothing once the old directory is gone or the new one exists. */
function moveLegacyServerDirectory(legacy, directory) {
  if (!fs.existsSync(legacy) || fs.existsSync(directory)) return;
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.renameSync(legacy, directory);
  if (fs.existsSync(path.join(directory, 'graphs')) && !fs.existsSync(path.join(directory, 'spaces'))) {
    fs.renameSync(path.join(directory, 'graphs'), path.join(directory, 'spaces'));
  }
  const list = path.join(directory, 'graphs.json');
  if (!fs.existsSync(list)) return;
  const relocate = (/** @type {string} */ from) => {
    if (from.startsWith(path.join(legacy, 'graphs') + path.sep)) return path.join(directory, 'spaces', path.relative(path.join(legacy, 'graphs'), from));
    if (from.startsWith(legacy + path.sep)) return path.join(directory, path.relative(legacy, from));
    return from;
  };
  const content = JSON.parse(fs.readFileSync(list, 'utf8'));
  for (const graph of content.graphs ?? []) graph.path = relocate(graph.path);
  fs.writeFileSync(list, JSON.stringify(content, null, 2) + '\n');
}
