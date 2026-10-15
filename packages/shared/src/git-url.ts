// Git URLs Aimparency opens read-only (see backend git-repository-cache).
// Pure, so the project picker recognizes a URL by the same rule.

/**
 * The cache location of a repository (host/owner/repo), or null when `url` is
 * not a Git URL we clone. Only https and ssh: other transports (ext::, file,
 * local paths) can run commands or read the machine. `file:` only for tests.
 */
export function gitRepositoryLocation(url: string, { allowFileUrls = false } = {}): string[] | null {
  const trimmed = url.trim();
  let host: string;
  let repoPath: string;
  const scp = /^[\w.-]+@([\w.-]+):(?!\/\/)(.+)$/.exec(trimmed); // git@host:owner/repo
  if (scp) {
    host = scp[1]!;
    repoPath = scp[2]!;
  } else {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    const allowed = ['https:', 'http:', 'ssh:', ...(allowFileUrls ? ['file:'] : [])];
    if (!allowed.includes(parsed.protocol)) return null;
    host = parsed.protocol === 'file:' ? 'local' : parsed.hostname;
    repoPath = parsed.pathname;
  }
  const segments = repoPath.replace(/\.git\/?$/, '').split('/').filter(Boolean);
  if (!host || segments.length === 0 || [host, ...segments].some((segment) => segment === '..' || segment === '.' || segment.startsWith('-'))) {
    return null;
  }
  return [host, ...segments];
}
