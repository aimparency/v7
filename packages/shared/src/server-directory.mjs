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
