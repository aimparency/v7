import * as fs from 'fs';
import * as path from 'path';

/**
 * Detect edits to the wrapped-agents' OWN source so the supervisor can decide to
 * rebuild + relaunch its session worker (aim 5af61b3e). The running session is
 * built/transpiled at launch (dev runs via tsx, which does NOT watch), so a
 * source file touched after the process started means the live code is stale and
 * a relaunch would pick up the change.
 *
 * Detection is mtime-based (vs. `git status`): it catches both uncommitted edits
 * AND committed-then-not-rebuilt changes (a commit/checkout still rewrites the
 * working-tree file), and needs no child process in the supervisor tick.
 *
 * Scope: each package's `src/**` *.ts. We prune build/vendor output and the
 * `client` package — that's the browser UI, bundled separately and never part of
 * the Node session runtime, so editing it should not trigger a worker relaunch.
 */

const DEFAULT_SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'client']);

interface WrapperWatchOptions {
  /** Directory names to prune anywhere in the tree. */
  skipDirs?: Set<string>;
}

/** Recursively collect wrapper source files (paths under a `src/` segment). */
function collectSourceFiles(rootDir: string, skipDirs: Set<string>): string[] {
  const out: string[] = [];

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir — best-effort
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        // only actual package sources, i.e. somewhere under a `src/` directory
        path.join(dir, entry.name).split(path.sep).includes('src')
      ) {
        out.push(path.join(dir, entry.name));
      }
    }
  };

  walk(rootDir);
  return out;
}

function safeMtimeMs(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Newest mtime (ms) across wrapper source files; 0 if none/unreadable. Captured
 * once at supervisor start to use as the "since launch" baseline — more robust
 * than wall-clock now (ignores clock skew, anchors to the actual on-disk state).
 */
export function latestWrapperSourceMtime(
  rootDir: string,
  options: WrapperWatchOptions = {},
): number {
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  let latest = 0;
  for (const file of collectSourceFiles(rootDir, skipDirs)) {
    const m = safeMtimeMs(file);
    if (m > latest) latest = m;
  }
  return latest;
}

/**
 * Wrapper source files modified after `sinceMs`. Non-empty ⇒ the running build
 * is stale (the "dirty" condition).
 */
export function findChangedWrapperSources(
  rootDir: string,
  sinceMs: number,
  options: WrapperWatchOptions = {},
): string[] {
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  return collectSourceFiles(rootDir, skipDirs).filter((file) => safeMtimeMs(file) > sinceMs);
}
