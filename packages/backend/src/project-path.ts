import { toBowmanPath } from 'shared';

/**
 * Callers pass either the repo root (`~/ideas`) or the bowman dir (`~/ideas/.bowman`).
 * Every per-project cache must key on one form, otherwise writes and reads land in
 * different buckets (e.g. new ideas indexed under one key, searched under the other).
 */
export function normalizeProjectPath(p: string): string {
  return toBowmanPath(p);
}
