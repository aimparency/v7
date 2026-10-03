import type { Idea, RepoConnection } from "shared";
import type { BackendClient } from "../client.js";

// Compact idea JSON for agents: no graph layout positions, no empty arrays.
export function formatIdea(idea: Partial<Idea>) {
  const compact: Record<string, unknown> = { ...idea };
  if (idea.supportingConnections?.length) {
    compact.supportingConnections = idea.supportingConnections.map(({ relativePosition: _layout, ...connection }) => connection);
  } else {
    delete compact.supportingConnections;
  }
  for (const key of ["supportingRepos", "supportedIdeas", "committedIn", "tags"] as const) {
    if (idea[key]?.length === 0) delete compact[key];
  }
  return compact;
}

export function formatIdeas(ideas: Partial<Idea>[]) {
  return ideas.map(formatIdea);
}

// A repo edge as stored, or as described below (with name and health).
type RepoEdge = Pick<RepoConnection, "repoId" | "weight" | "explanation" | "reflection"> & Record<string, unknown>;

// Repo-level cross-repo links are black-box edges: {repoId} and no ideaId, so a
// raw supportingRepos array tells an agent nothing but a UUID. Resolve each one
// against the linked-repo registry to a name plus a minimal health state.
// Deliberately only three states — the richer per-edge vocabulary belongs to the
// cancelled idea-level design; a whole-repo link is either resolvable or not.
export async function describeRepoEdges(trpcClient: BackendClient, projectPath: string, ideas: Array<{ supportingRepos?: RepoEdge[] }>) {
  if (!ideas.some((a) => a?.supportingRepos?.length)) return; // no registry round-trip
  let registry: Awaited<ReturnType<BackendClient["linkedRepo"]["list"]["query"]>> = [];
  try {
    registry = await trpcClient.linkedRepo.list.query({ projectPath });
  } catch {
    // Registry unreadable: degrade to bare repoIds rather than failing the read.
  }
  const byId = new Map(registry.map((r) => [r.repoId, r]));
  for (const idea of ideas) {
    if (!idea?.supportingRepos?.length) continue;
    idea.supportingRepos = idea.supportingRepos.map((edge) => {
      const entry = byId.get(edge.repoId);
      return {
        repoId: edge.repoId,
        ...(entry?.name ? { name: entry.name } : {}),
        weight: edge.weight ?? 1,
        ...(edge.explanation !== undefined ? { explanation: edge.explanation } : {}),
        ...(edge.reflection !== undefined ? { reflection: edge.reflection } : {}),
        health: !entry ? "unknown-repo" : entry.resolved ? "resolved" : "not-checked-out",
      };
    });
  }
}
