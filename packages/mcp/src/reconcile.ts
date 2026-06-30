// Pure, side-effect-free core of the realized-commit / status-reconciliation
// signal. Kept out of tools.ts (which pulls in the MCP server + a WS tRPC
// client at import) so this logic is unit-testable on its own.

/**
 * Count, per aim id, how many of the given commit messages reference it. A
 * commit "references" an aim when its message contains the aim's 8-char id
 * prefix — the convention used in this repo's commit messages.
 */
export function countAimReferences(commitMessages: string[], aimIds: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  const prefixes = aimIds
    .filter((id) => typeof id === "string" && id.length >= 8)
    .map((id) => [id, id.slice(0, 8)] as const);
  for (const msg of commitMessages) {
    for (const [id, prefix] of prefixes) {
      if (msg.includes(prefix)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

export interface ReconcileCandidate {
  id: string;
  text: string;
  status: string;
  commitCount: number;
}

/**
 * Status-reconciliation core (aim 7625d5e6): surface aims that are still `open`
 * yet are referenced by >= 1 git commit. Per this project's convention a commit
 * names the aim it advances (e.g. "feat(x): … (8charId)"), so an OPEN aim with
 * commit references is the classic drift — work shipped but the status never got
 * flipped. Ranked by commit count desc. Read-only: a review list to confirm
 * done, not an auto-applier (a commit can touch an aim without finishing it).
 */
export function findReconciliationCandidates(
  aims: Array<{ id: string; text: string; status: { state: string } }>,
  referenceCounts: Map<string, number>,
): ReconcileCandidate[] {
  return aims
    .filter((a) => a.status?.state === "open" && (referenceCounts.get(a.id) ?? 0) > 0)
    .map((a) => ({ id: a.id, text: a.text, status: a.status.state, commitCount: referenceCounts.get(a.id)! }))
    .sort((x, y) => y.commitCount - x.commitCount);
}
