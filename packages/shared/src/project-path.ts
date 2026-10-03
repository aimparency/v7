// A project is addressed either by its root directory or by its .bowman
// directory, and agents use both. Every component converts through these two
// functions, so a .bowman path is never nested into another .bowman (which
// earlier code did, leaving .bowman/.bowman/vectors.json behind).
//
// String-based on purpose (no node:path), so the browser bundle can use it.

import { AIMPARENCY_DIR_NAME } from './constants.js';

function splitTrailingBowman(input: string): { root: string; separator: string } {
  const separator = input.includes('/') || !input.includes('\\') ? '/' : '\\';
  let root = input.replace(/[\\/]+$/, '');
  // Strip every trailing .bowman segment: <project>/.bowman and the doubled
  // <project>/.bowman/.bowman both belong to <project>.
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
