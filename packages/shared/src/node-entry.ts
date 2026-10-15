// Node-only helpers for code that runs both from source (tsx, dev) and as a
// bundle (tsdown, `pnpm start`). Kept out of the browser-shared index.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** True when the calling module runs from TypeScript source (tsx), false inside a bundle. */
export function runsFromSource(callerUrl: string): boolean {
  return callerUrl.endsWith('.ts');
}

/**
 * Node argv for spawning a package entry in the caller's own mode: the source
 * entry through the tsx loader, or the bundled entry as plain JS.
 */
export function nodeEntryArgs(callerUrl: string, sourceEntry: string, bundleEntry: string): string[] {
  return runsFromSource(callerUrl) ? ['--import', 'tsx', sourceEntry] : [bundleEntry];
}

/**
 * Directory of the nearest package.json above the calling module. Stable across
 * source (`src/a/b.ts`) and bundle (`dist/index.js`) layouts, unlike `__dirname`
 * depth arithmetic.
 */
export function packageRoot(callerUrl: string): string {
  let dir = path.dirname(fileURLToPath(callerUrl));
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`No package.json above ${fileURLToPath(callerUrl)}`);
    dir = parent;
  }
  return dir;
}

/**
 * Runs `fn` while holding an exclusive lock on `filePath` across processes
 * (atomic mkdir of `<filePath>.lock`). For read-modify-write cycles on a file
 * that several processes change, e.g. the backend and loop workers on
 * runtime/loops.json. A lock older than `staleMs` is from a crashed holder.
 */
export async function withProcessFileLock<T>(filePath: string, fn: () => Promise<T>, staleMs = 10_000): Promise<T> {
  const lockPath = `${filePath}.lock`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  for (;;) {
    try {
      await fs.promises.mkdir(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const age = await fs.promises.stat(lockPath).then((stats) => Date.now() - stats.mtimeMs, () => 0);
      if (age > staleMs) await fs.promises.rm(lockPath, { recursive: true, force: true });
      else await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  try {
    return await fn();
  } finally {
    await fs.promises.rm(lockPath, { recursive: true, force: true });
  }
}
