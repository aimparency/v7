import type { BackendClient } from "../client.js";

export function formatIdea(idea: any) {
  if (idea.supportingConnections) {
    if (idea.supportingConnections.length === 0) {
        delete idea.supportingConnections;
    } else {
        idea.supportingConnections = idea.supportingConnections.map((conn: any) => {
          const { relativePosition, ...rest } = conn;
          return rest;
        });
    }
  }
  if (idea.supportingRepos && idea.supportingRepos.length === 0) delete idea.supportingRepos;
  if (idea.supportedIdeas && idea.supportedIdeas.length === 0) delete idea.supportedIdeas;
  if (idea.committedIn && idea.committedIn.length === 0) delete idea.committedIn;
  if (idea.tags && idea.tags.length === 0) delete idea.tags;
  
  return idea;
}

export function formatIdeas(ideas: any[]) {
  return ideas.map(formatIdea);
}

// Repo-level cross-repo links are black-box edges: {repoId} and no ideaId, so a
// raw supportingRepos array tells an agent nothing but a UUID. Resolve each one
// against the linked-repo registry to a name plus a minimal health state.
// Deliberately only three states — the richer per-edge vocabulary belongs to the
// cancelled idea-level design; a whole-repo link is either resolvable or not.
export async function describeRepoEdges(trpcClient: BackendClient, projectPath: string, ideas: any[]) {
  if (!ideas.some((a) => a?.supportingRepos?.length)) return; // no registry round-trip
  let registry: any[] = [];
  try {
    registry = await trpcClient.linkedRepo.list.query({ projectPath });
  } catch {
    // Registry unreadable: degrade to bare repoIds rather than failing the read.
  }
  const byId = new Map(registry.map((r: any) => [r.repoId, r]));
  for (const idea of ideas) {
    if (!idea?.supportingRepos?.length) continue;
    idea.supportingRepos = idea.supportingRepos.map((edge: any) => {
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
