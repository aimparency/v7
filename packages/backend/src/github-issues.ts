// Reading a repository's open GitHub issues, to start its graph from them.
// Public REST API: no token needed for public repositories (60 requests per
// hour); GITHUB_TOKEN, when set, raises that limit and reaches private ones.
import { gitRepositoryLocation } from 'shared';

export type GithubIssue = {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
};

const MAX_PAGES = 10; // 1000 issues

/** owner/repo from "owner/repo" or a github.com URL; null otherwise. */
export function parseGithubRepository(reference: string): { owner: string; repo: string } | null {
  const trimmed = reference.trim();
  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed);
  if (short) return { owner: short[1]!, repo: short[2]!.replace(/\.git$/, '') };
  const location = gitRepositoryLocation(trimmed);
  if (!location || location[0] !== 'github.com' || location.length !== 3) return null;
  return { owner: location[1]!, repo: location[2]! };
}

export async function fetchOpenGithubIssues(owner: string, repo: string, fetchImpl: typeof fetch = fetch): Promise<GithubIssue[]> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'aimparency' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const issues: GithubIssue[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100&page=${page}`, { headers });
    if (!response.ok) {
      const detail = await response.json().then((body: { message?: string }) => body.message, () => undefined);
      const hint = response.status === 404 ? ' (repository not found, or private without GITHUB_TOKEN)' : '';
      throw new Error(`GitHub answered ${response.status} for ${owner}/${repo}: ${detail ?? response.statusText}${hint}`);
    }
    const batch = await response.json() as Array<{ number: number; title: string; body: string | null; html_url: string; labels: Array<string | { name?: string }>; pull_request?: unknown }>;
    for (const item of batch) {
      if (item.pull_request) continue; // the issues endpoint lists pull requests too
      issues.push({
        number: item.number,
        title: item.title,
        body: item.body ?? '',
        url: item.html_url,
        labels: item.labels.map((label) => typeof label === 'string' ? label : label.name ?? '').filter(Boolean)
      });
    }
    if (batch.length < 100) break;
  }
  return issues;
}
