import type { Idea } from "shared";

// An idea hands each child `weight / (selfWeight + Σ weights)` of the value
// reaching it and keeps the rest, its loop share (selfWeight), for its own work
// (shared/value-calculation.ts). Agents judge such shares in percent next to
// the siblings far better than raw weights, so they give percentages and the
// weights follow: stored weights become those percentages.

type ShareParent = Pick<Idea, "id" | "supportingConnections" | "selfWeight"> & Partial<Pick<Idea, "supportingRepos">>;

export interface ShareRequest {
  /** Child idea id → percent of the parent's value it carries. */
  shares: Map<string, number>;
  /** Percent the parent keeps for its own work. */
  loopShare?: number;
}

const EPSILON = 1e-6;

export function validatePercent(value: unknown, what: string, allowZero: boolean): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100 || (!allowZero && value === 0)) {
    throw new Error(`${what} must be a percentage ${allowZero ? "from 0" : "above 0"} up to 100, got ${String(value)}.`);
  }
  return value;
}

/**
 * New weights for a parent after setting some shares in percent. Children and
 * the loop not named keep their proportions to each other and fill the rest;
 * when nothing unnamed is left to take it, the rest stays with the parent as
 * its loop share, so the named children need not add up to 100%.
 */
export function applyShares(parent: ShareParent, request: ShareRequest): Pick<Idea, "supportingConnections" | "selfWeight" | "supportingRepos"> {
  if (parent.supportingConnections.some((conn) => conn.ideaId === parent.id)) {
    throw new Error(`Idea ${parent.id} links to itself; set its weights directly instead of shares.`);
  }
  for (const [ideaId, share] of request.shares) {
    validatePercent(share, `Share of ${ideaId}`, false);
    if (!parent.supportingConnections.some((conn) => conn.ideaId === ideaId)) {
      throw new Error(`${ideaId} is not a child of ${parent.id}, so it has no share to set.`);
    }
  }
  if (request.loopShare !== undefined) validatePercent(request.loopShare, "Loop share", true);

  const named = [...request.shares.values()].reduce((sum, share) => sum + share, 0) + (request.loopShare ?? 0);
  if (named > 100 + EPSILON) {
    throw new Error(`The shares given for ${parent.id} add up to ${round(named)}%, more than 100%.`);
  }
  const rest = Math.max(0, 100 - named);

  const unnamedChildren = parent.supportingConnections.filter((conn) => !request.shares.has(conn.ideaId));
  const repos = parent.supportingRepos ?? [];
  const unnamedLoop = request.loopShare === undefined ? parent.selfWeight ?? 0 : 0;
  const unnamedWeight = unnamedChildren.reduce((sum, conn) => sum + (conn.weight || 1), 0)
    + repos.reduce((sum, repo) => sum + (repo.weight ?? 1), 0)
    + unnamedLoop;

  if (unnamedChildren.length + repos.length > 0 && rest <= EPSILON) {
    throw new Error(
      `The shares given for ${parent.id} leave nothing for its other children (${unnamedChildren.map((conn) => conn.ideaId).join(", ")}). ` +
      "Give them shares too, or unlink them.",
    );
  }
  // Nothing unnamed to scale: the rest is the parent's own (loop) share,
  // unless the loop was named too, then the named shares must cover 100%.
  if (unnamedWeight <= EPSILON && request.loopShare !== undefined && rest > EPSILON) {
    throw new Error(`The shares given for ${parent.id} add up to ${round(named)}%; with every child and the loop named they must add up to 100%.`);
  }
  const scale = unnamedWeight > EPSILON ? rest / unnamedWeight : 0;

  return {
    supportingConnections: parent.supportingConnections.map((conn) => ({
      ...conn,
      weight: request.shares.get(conn.ideaId) ?? (conn.weight || 1) * scale,
    })),
    supportingRepos: repos.map((repo) => ({ ...repo, weight: (repo.weight ?? 1) * scale })),
    selfWeight: request.loopShare ?? (unnamedWeight > EPSILON ? unnamedLoop * scale : rest),
  };
}

/** The parent's split in percent: each child, each linked repo, and its loop. */
export function describeShares(parent: ShareParent & Pick<Idea, "text">, childTexts: Map<string, string>, focusId?: string): string {
  const parts = [
    ...parent.supportingConnections.map((conn) => ({
      label: `${conn.ideaId === focusId ? "→ " : ""}${childTexts.get(conn.ideaId) ?? conn.ideaId} (${conn.ideaId})`,
      weight: conn.ideaId === parent.id ? 0 : conn.weight || 1,
    })),
    ...(parent.supportingRepos ?? []).map((repo) => ({ label: `repo ${repo.repoId}`, weight: repo.weight ?? 1 })),
  ];
  const loop = (parent.selfWeight ?? 0) + parent.supportingConnections
    .filter((conn) => conn.ideaId === parent.id).reduce((sum, conn) => sum + (conn.weight || 1), 0);
  const total = parts.reduce((sum, part) => sum + part.weight, 0) + loop;
  const percent = (weight: number) => `${total > 0 ? round(100 * weight / total) : 100}%`;
  return [
    `"${parent.text}" (${parent.id}) splits the value reaching it:`,
    ...parts.filter((part) => part.weight > 0).map((part) => `  ${percent(part.weight)} ${part.label}`),
    `  ${percent(loop)} loop: kept for its own work`,
  ].join("\n");
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

export const SHARE_GUIDE =
  "Shares are percent of the parent's value. Siblings you don't name keep their proportions and fill the rest; " +
  "children need not add up to 100%: the parent keeps the rest as its loop share for its own work.";
