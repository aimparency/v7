import { calculateIdeaValues, defaultIdeaCost, type Idea } from "shared";
import type { BackendClient } from "../client.js";

// Work in the spaces that contribute to this one, on this space's scale. The
// value flowing into a linked space's node here (V) stands in for that
// space's whole intrinsic value (T): its ideas' value scales by V/T, their
// aggregated cost doesn't, so their priority scales by V/T too. Only spaces
// checked out on this machine take part, one level down. Their costs count in
// their own unit: a different unit makes the comparison rough, and is said.

export type LinkedCandidate = {
  id: string, text: string, status: string, priority: number, flowedValue: number, aggregatedCost: number,
  space: { name: string, repoId: string, path: string, costUnit: string }
};

const OPEN = new Set(["open", "partially"]);

export async function linkedSpaceCandidates(
  trpcClient: BackendClient, space: string, ideas: Idea[], values: Map<string, number>, totalIntrinsic: number, costUnit: string
): Promise<{ candidates: LinkedCandidate[], notes: string[] }> {
  const linked = new Set(ideas.flatMap((idea) => idea.supportingRepos?.map((edge) => edge.repoId) ?? []));
  if (linked.size === 0) return { candidates: [], notes: [] };
  const repos = await trpcClient.linkedRepo.list.query({ space });
  const candidates: LinkedCandidate[] = [];
  const notes: string[] = [];
  for (const repo of repos) {
    if (!linked.has(repo.repoId)) continue;
    if (!repo.localPath || repo.missing) {
      notes.push(`${repo.name}: not checked out here${repo.missing ? " (folder moved)" : ""}, left out.`);
      continue;
    }
    const inflow = (values.get(repo.repoId) ?? 0) * totalIntrinsic;
    const [theirIdeas, theirMeta] = await Promise.all([
      trpcClient.idea.list.query({ space: repo.localPath }),
      trpcClient.project.getMeta.query({ space: repo.localPath }).catch(() => null),
    ]);
    const theirs = calculateIdeaValues(theirIdeas, defaultIdeaCost(theirMeta));
    if (theirs.totalIntrinsic <= 0 || inflow <= 0) {
      notes.push(`${repo.name}: ${inflow <= 0 ? "no value flows into it here" : "carries no intrinsic value of its own"}, left out.`);
      continue;
    }
    const scale = inflow / theirs.totalIntrinsic;
    const theirCostUnit = theirMeta?.costUnit || "abstract units";
    if (theirCostUnit !== costUnit) notes.push(`${repo.name} counts cost in ${theirCostUnit}, this space in ${costUnit}: its priorities compare only roughly.`);
    const openChildren = new Set(theirIdeas.flatMap((idea) => OPEN.has(idea.status.state) ? idea.supportedIdeas : []));
    for (const idea of theirIdeas) {
      if (!OPEN.has(idea.status.state) || openChildren.has(idea.id)) continue;
      candidates.push({
        id: idea.id, text: idea.text, status: idea.status.state,
        priority: (theirs.priorities.get(idea.id) ?? 0) * scale,
        flowedValue: (theirs.values.get(idea.id) ?? 0) * theirs.totalIntrinsic * scale,
        aggregatedCost: theirs.costs.get(idea.id) ?? 0,
        space: { name: repo.name, repoId: repo.repoId, path: repo.localPath, costUnit: theirCostUnit },
      });
    }
  }
  return { candidates: candidates.sort((a, b) => b.priority - a.priority), notes };
}
