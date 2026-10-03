// Copy of packages/shared/src/project-path.ts for this CommonJS package, which
// cannot require shared's ESM-only build. Keep both in sync.

const AIMPARENCY_DIR_NAME = process.env.AIMPARENCY_DIR_NAME || '.bowman';

function splitTrailingBowman(input: string): { root: string; separator: string } {
  const separator = input.includes('/') || !input.includes('\\') ? '/' : '\\';
  let root = input.replace(/[\\/]+$/, '');
  for (;;) {
    const match = root.match(/^(.*?)[\\/]+([^\\/]+)$/);
    if (match?.[2] === AIMPARENCY_DIR_NAME) {
      root = match[1] === '' ? separator : match[1]!;
    } else if (root === AIMPARENCY_DIR_NAME) {
      root = '.';
    } else {
      break;
    }
  }
  return { root, separator };
}

/** The project's root directory, whether given the root or its .bowman directory. */
export function toProjectRoot(input: string): string {
  if (!input) return input;
  return splitTrailingBowman(input).root;
}

/** The project's .bowman directory, whether given the root or the .bowman directory. */
export function toBowmanPath(input: string): string {
  if (!input) return input;
  const { root, separator } = splitTrailingBowman(input);
  return root.endsWith(separator) ? `${root}${AIMPARENCY_DIR_NAME}` : `${root}${separator}${AIMPARENCY_DIR_NAME}`;
}
