import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { calculateIdeaValues, defaultIdeaCost } from "shared";
import { IDEA_STATES_DESCRIPTION, PROJECT_PATH_TOOL_PROPERTY } from "./constants.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import * as path from "path";

// --- Realized-cost signal (c0a45822: reality→priority feedback) ---------------
// Real git commits that reference an idea are evidence of actual output. Counting
// them grounds the COST side of priority in reality WITHOUT mutating the
// human-set intrinsicValue/cost (the chosen, non-corrupting design). Heuristic:
// a commit "references" an idea when its message contains the idea's 8-char id
// prefix — the convention used in this repo's commit messages.
// Pure realized-commit / reconciliation helpers live in ./reconcile.ts (no MCP
// server / tRPC client imports) so they stay unit-testable. Re-exported here to
// preserve the existing import surface (countIdeaReferences).
export { countIdeaReferences, findReconciliationCandidates } from "./reconcile.js";
import { countIdeaReferences, findReconciliationCandidates } from "./reconcile.js";
import { extractCodeTokens, scoreCodePresence } from "./code-presence.js";
import { CONTINUE_HOOK_AGENTS, disableContinueHook, enableContinueHook } from "./continue-hook.js";

/**
 * Verification evidence expected before an idea may be 'implemented', tailored to the
 * idea's apparent type (inferred from text/description/tags). Keeps the soft
 * implemented-gate concrete — "implemented = verified, not claimed" — instead of a
 * generic reminder. Exported for unit testing.
 */
export function verificationHintForIdea(
  idea: { text?: string; description?: string; tags?: string[] } | null | undefined,
): string {
  const hay = `${idea?.text ?? ""} ${idea?.description ?? ""} ${(idea?.tags ?? []).join(" ")}`.toLowerCase();
  const has = (re: RegExp) => re.test(hay);
  // UI/visual first: a change to something visual is best proven by seeing it run.
  if (has(/\b(ui|visual|render|screenshot|css|layout|animation|colou?rs?|button|modal|flicker|paint|style|icon|badge|dropdown|graph view)\b/))
    return "a screenshot or interaction proof that you saw it working in the running app";
  if (has(/\b(bug|fix|repro|broken|regression|crash|incorrect|wrong|stale|leak|race)\b/))
    return "a repro that now passes — the previously-failing case, now green";
  if (has(/\b(refactor|implement|backend|api|tool|schema|mcp|endpoint|function|module|migration|test|type-?check)\b/))
    return "tests + typecheck passing — cite exactly what you ran";
  return "what you ran/checked to confirm it actually works — tests, a repro, or a screenshot";
}

// Best-effort: one commit message per element (subject+body). Returns [] when the
// project isn't a git repo or git is unavailable, so the signal degrades
// gracefully and never breaks prioritization.
// `pathspec` (git pathspec args, e.g. ['--', '.', ':(exclude).bowman']) restricts
// to commits that touched matching files. Reconciliation passes a code-only
// pathspec so pure graph-bookkeeping commits (chore(graph)/chore(bowman) that
// merely cite idea ids while triaging/reframing the graph) don't masquerade as
// "this idea was implemented" — they touch only .bowman/.
function getRepoCommitMessages(projectPath: string, maxCommits = 2000, pathspec: string[] = []): string[] {
  try {
    const repoRoot = path.basename(projectPath) === ".bowman" ? path.dirname(projectPath) : projectPath;
    const out = execFileSync(
      "git",
      ["log", `-${maxCommits}`, "--format=%s%n%b%n--END-COMMIT--", ...pathspec],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 }
    );
    return out.split("--END-COMMIT--").filter((m) => m.trim().length > 0);
  } catch {
    return [];
  }
}

// Commits that changed at least one file outside .bowman/ — i.e. real code work,
// not graph metadata edits. The basis for the reconciliation signal.
const CODE_ONLY_PATHSPEC = ["--", ".", ":(exclude).bowman"];

// True if `token` (fixed string) appears in any tracked code file outside
// .bowman/. git grep exits 0 on a match, 1 on none (execFileSync throws) — the
// catch covers "no match" and "not a git repo" alike. Used by the code-presence
// reconciliation heuristic.
function gitGrepMatches(projectPath: string, token: string): boolean {
  try {
    const repoRoot = path.basename(projectPath) === ".bowman" ? path.dirname(projectPath) : projectPath;
    execFileSync(
      "git",
      ["grep", "-F", "-I", "-l", "-e", token, "--", ".", ":(exclude).bowman"],
      { cwd: repoRoot, stdio: ["ignore", "ignore", "ignore"], maxBuffer: 8 * 1024 * 1024 }
    );
    return true;
  } catch {
    return false;
  }
}

function formatIdea(idea: any) {
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

function formatIdeas(ideas: any[]) {
  return ideas.map(formatIdea);
}

// Repo-level cross-repo links are black-box edges: {repoId} and no ideaId, so a
// raw supportingRepos array tells an agent nothing but a UUID. Resolve each one
// against the linked-repo registry to a name plus a minimal health state.
// Deliberately only three states — the richer per-edge vocabulary belongs to the
// cancelled idea-level design; a whole-repo link is either resolvable or not.
async function describeRepoEdges(trpcClient: any, projectPath: string, ideas: any[]) {
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

type ConnectionInput = string | {
  ideaId: string;
  weight?: number;
  explanation?: string;
};

function connectionInputSchema(description: string) {
  return {
    type: "array",
    description,
    items: {
      anyOf: [
        { type: "string" },
        {
          type: "object",
          properties: { ideaId: { type: "string" }, weight: { type: "number" }, explanation: { type: "string" } },
          required: ["ideaId"],
        },
      ],
    },
  };
}

function normalizeConnectionInput(input: ConnectionInput): Exclude<ConnectionInput, string> {
  return typeof input === "string" ? { ideaId: input } : input;
}

function connectionId(input: ConnectionInput): string {
  return typeof input === "string" ? input : input.ideaId;
}

function toStoredConnection(input: ConnectionInput) {
  const conn = normalizeConnectionInput(input);
  return {
    ideaId: conn.ideaId,
    weight: conn.weight ?? 1,
    ...(conn.explanation !== undefined ? { explanation: conn.explanation } : {}),
  };
}

type PhasePlacementArgs = {
  order?: number;
  before?: string;
  after?: string;
};

type PhaseSibling = {
  id: string;
  name: string;
};

export function resolvePhasePlacement(
  placement: PhasePlacementArgs,
  siblings: PhaseSibling[],
): number | undefined {
  const constraints: Array<{ label: string; order: number }> = [];

  if (placement.order !== undefined) {
    if (!Number.isInteger(placement.order) || placement.order < 0) {
      throw new Error(`order must be a non-negative integer; received ${placement.order}.`);
    }
    constraints.push({ label: `order=${placement.order}`, order: placement.order });
  }

  const resolveNamedSibling = (relation: "before" | "after", name: string) => {
    const matches = siblings
      .map((phase, index) => ({ phase, index }))
      .filter(({ phase }) => phase.name === name);
    const available = siblings.length
      ? siblings.map((phase) => `"${phase.name}" [${phase.id}]`).join(", ")
      : "(none)";

    if (matches.length === 0) {
      throw new Error(
        `Cannot place ${relation} "${name}": no sibling phase has that exact name. ` +
        `Available siblings: ${available}.`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Cannot place ${relation} "${name}": the sibling name is ambiguous. ` +
        `Matches: ${matches.map(({ phase }) => `"${phase.name}" [${phase.id}]`).join(", ")}. ` +
        `Rename a sibling or use order.`,
      );
    }

    const resolvedOrder = matches[0].index + (relation === "after" ? 1 : 0);
    constraints.push({
      label: `${relation}="${name}"→${resolvedOrder}`,
      order: resolvedOrder,
    });
  };

  if (placement.before !== undefined) resolveNamedSibling("before", placement.before);
  if (placement.after !== undefined) resolveNamedSibling("after", placement.after);
  if (constraints.length === 0) return undefined;

  const resolvedOrder = constraints[0].order;
  if (constraints.some((constraint) => constraint.order !== resolvedOrder)) {
    throw new Error(
      `Phase placement constraints disagree: ${constraints.map(({ label }) => label).join(", ")}. ` +
      "When multiple placement arguments are supplied, they must resolve to the same insertion index.",
    );
  }
  if (resolvedOrder > siblings.length) {
    throw new Error(
      `Resolved phase order ${resolvedOrder} is beyond the ${siblings.length} available sibling positions.`,
    );
  }

  return resolvedOrder;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function ideaCreationConfirmationToken(args: Record<string, unknown>): string {
  const { confirmationToken: _confirmationToken, ...proposal } = args;
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(proposal)))
    .digest("hex")
    .slice(0, 24);
}

export function registerTools(server: Server, trpcClient: any) {
  if (!trpcClient) throw new Error("registerTools requires a tRPC client");
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_idea",
          description: "Get one idea's raw fields by ID. To orient before working on it, prefer get_idea_context.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              ideaId: { type: "string" }
            },
            required: ["projectPath", "ideaId"],
          },
        },
        {
          name: "get_idea_context",
          description: "Orient before acting: returns the idea, every distinct root-first mission path (paths_to_root), the backward-compatible highest-value path (path_to_root), related ideas, immediate parents, and children. Cyclic/non-root branches are excluded and truncation is reported.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              ideaId: { type: "string" }
            },
            required: ["projectPath", "ideaId"],
          },
        },
        {
          name: "search_ideas",
          description: "Search ideas by text/status. Empty query = most recently updated. Search before creating a new idea to avoid duplicates.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              query: { type: "string" },
              status: { type: ["string", "array"], items: { type: "string" } },
              phaseId: { type: "string" },
              archived: { type: "boolean" },
              limit: { type: "number" },
              offset: { type: "number" }
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "list_phase_ideas_recursive",
          description: "Open ideas under a phase as a nested tree (keeps parent path to open descendants). Pass status to override.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              phaseId: { type: "string" },
              status: { type: ["string", "array"], items: { type: "string" } }
            },
            required: ["projectPath", "phaseId"],
          },
        },
        {
          name: "list_phases",
          description: "List phases in order. parentPhaseId → its children; omitted → all phases.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              parentPhaseId: { type: ["string", "null"] },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "search_phases",
          description: "Search phases by name",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              query: { type: "string" },
              parentPhaseId: { type: ["string", "null"] },
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "create_idea",
          description: "Two-step creation: first call returns related active/cancelled ideas and a confirmationToken without writing. Review that context, then repeat the identical call with confirmationToken to create. Similarity informs judgment; it does not forbid a genuinely distinct idea. Connect the idea to the mission it serves.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              text: { type: "string" },
              description: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              status: {
                type: "object",
                properties: {
                  state: { type: "string", description: IDEA_STATES_DESCRIPTION },
                  comment: { type: "string" },
                  reviewedAt: { type: "number", description: "Timestamp confirming status and intention still hold (keeps the transition date)." },
                },
              },
              supportingConnections: connectionInputSchema("Child ideas: UUIDs or { ideaId, weight, explanation }."),
              supportedIdeas: connectionInputSchema("Parent ideas this one serves: UUIDs or { ideaId, weight, explanation } for the parent→new-idea edge."),
              intrinsicValue: { type: "number", minimum: 0, description: "Standalone estimated value; includes expected partial completion or failure" },
              valueRationale: { type: "string", description: "Human-authored rationale for the standalone estimated value; never auto-derived" },
              cost: { type: "number", exclusiveMinimum: 0, description: "Positive estimated direct present cost in the project's cost unit (see get_prioritized_ideas economics); omitted = project default" },
              duration: { type: "number", minimum: 0, description: "Estimated days from now until the idea's value is realized" },
              phaseId: { type: "string" },
              confirmationToken: { type: "string", description: "Token returned by the review-only first call. Any proposal edit requires a fresh review." },
            },
            required: ["projectPath", "text"],
          },
        },
        {
          name: "update_idea",
          description: "Update idea fields; only the given ones change. Links change through add*/remove*. reflection is a free-text note; set it with status=implemented to record verification evidence (verified-done, not claimed-done). When blocked set unclear/human-dependent with a comment.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              ideaId: { type: "string" },
              text: { type: "string" },
              description: { type: "string" },
              reflection: { type: "string", description: "Free-text note/reflection on the idea; can be updated together with status without changing other fields." },
              tags: { type: "array", items: { type: "string" } },
              status: {
                type: "object",
                properties: {
                  state: { type: "string", description: IDEA_STATES_DESCRIPTION },
                  comment: { type: "string" },
                  reviewedAt: { type: "number", description: "Timestamp confirming status and intention still hold (keeps the transition date)." },
                },
              },
              addSupportingConnections: connectionInputSchema("Add child links, or update weight/explanation of existing ones."),
              removeSupportingConnections: { type: "array", items: { type: "string" }, description: "Child idea UUIDs to unlink." },
              addSupportedIdeas: connectionInputSchema("Add parent links, or update weight/explanation of the parent→this-idea edge."),
              removeSupportedIdeas: { type: "array", items: { type: "string" }, description: "Parent idea UUIDs to unlink." },
              intrinsicValue: { type: "number", minimum: 0, description: "Standalone estimated value; includes expected partial completion or failure" },
              valueRationale: { type: "string", description: "Human-authored rationale for the standalone estimated value; never auto-derived" },
              cost: { type: "number", exclusiveMinimum: 0, description: "Positive estimated direct present cost in the project's cost unit (see get_prioritized_ideas economics); omitted = project default" },
              duration: { type: "number", minimum: 0, description: "Estimated days from now until the idea's value is realized" },
            },
            required: ["projectPath", "ideaId"],
          },
        },
        {
          name: "delete_idea",
          description: "Delete idea. Prefer status=cancelled unless duplicate/error.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              ideaId: { type: "string" }
            },
            required: ["projectPath", "ideaId"],
          },
        },
        {
          name: "addReflection",
          description: "Append a structured reflection (context, outcome, effectiveness, lesson) without changing idea status. For a simple free-text note, use update_idea.reflection.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              ideaId: { type: "string" },
              reflection: {
                type: "object",
                properties: {
                  context: { type: "string" },
                  outcome: { type: "string" },
                  effectiveness: { type: "string" },
                  lesson: { type: "string" },
                  pattern: { type: "string" }
                },
                required: ["context", "outcome", "effectiveness", "lesson"]
              }
            },
            required: ["projectPath", "ideaId", "reflection"],
          },
        },
        {
          name: "create_phase",
          description: "Create an ordered work horizon or timebox under an optional parent. Place it with order, before, or after (combined, they must agree; sibling names must match exactly and uniquely). Then use commit_idea_to_phase to make ideas discoverable and rankable.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              name: { type: "string" },
              parent: { type: ["string", "null"] },
              order: { type: "integer", minimum: 0, description: "Zero-based position among sibling phases." },
              before: { type: "string", description: "Insert before the sibling with this exact, unique phase name." },
              after: { type: "string", description: "Insert after the sibling with this exact, unique phase name." },
              from: { type: "number", description: "Optional phase start as Unix epoch milliseconds." },
              to: { type: "number", description: "Optional phase end as Unix epoch milliseconds." },
            },
            required: ["projectPath", "name"],
          },
        },
        {
          name: "update_phase",
          description: "Update phase name, parent, or optional epoch-ms boundaries.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              phaseId: { type: "string" },
              name: { type: "string" },
              parent: { type: ["string", "null"] },
              from: { type: "number", description: "Optional phase start as Unix epoch milliseconds." },
              to: { type: "number", description: "Optional phase end as Unix epoch milliseconds." },
            },
            required: ["projectPath", "phaseId"],
          },
        },
        {
          name: "delete_phase",
          description: "Delete phase (ideas remain, just uncommitted; child phases move up into its place)",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              phaseId: { type: "string" }
            },
            required: ["projectPath", "phaseId"],
          },
        },
        {
          name: "commit_idea_to_phase",
          description: "Commit idea to phase (insertionIndex sets order).",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              ideaId: { type: "string" },
              phaseId: { type: "string" },
              insertionIndex: { type: "number" },
            },
            required: ["projectPath", "ideaId", "phaseId"],
          },
        },
        {
          name: "remove_idea_from_phase",
          description: "Remove idea from phase (idea not deleted)",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              ideaId: { type: "string" },
              phaseId: { type: "string" },
            },
            required: ["projectPath", "ideaId", "phaseId"],
          },
        },
        {
          name: "list_linked_repos",
          description: "List the repos this project can link an idea to: repoId, name, and whether the repo is checked out on this machine (resolved). Call it to get the repoId that link_repo needs.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
            },
            required: ["projectPath"],
          },
        },
        {
          name: "register_linked_repo",
          description: "Make another locally checked-out Aimparency project linkable from this one (records its repoId, name and local path). Needed once per repo, before the first link_repo to it.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              targetPath: { type: "string", description: "Absolute path to the other project's .bowman dir (or its repo root)" },
              url: { type: "string", description: "Optional relocation hint, e.g. the git remote, so collaborators can find the repo" },
              access: { type: "string", enum: ["read", "write"], description: "Machine-local access intent for the linked checkout. Default read." },
            },
            required: ["projectPath", "targetPath"],
          },
        },
        {
          name: "link_repo",
          description: "Declare that a WHOLE external repo supports this idea — a black-box dependency. Targets a repo, never an idea inside it: there is no cross-repo idea link by design. Idempotent per repoId (re-linking updates weight/explanation). Value flows out of this idea into the repo, and the other repo keeps no back-reference.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              ideaId: { type: "string", description: "The LOCAL idea being supported" },
              repoId: { type: "string", description: "Linked repo UUID from list_linked_repos" },
              weight: { type: "number", description: "Share of this idea's value flowing into the repo, like any child edge. Default 1." },
              explanation: { type: "string", description: "Why that repo supports this idea" },
            },
            required: ["projectPath", "ideaId", "repoId"],
          },
        },
        {
          name: "unlink_repo",
          description: "Remove an idea→repo black-box link. Leaves the repo in the linked-repo registry.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              ideaId: { type: "string" },
              repoId: { type: "string" },
            },
            required: ["projectPath", "ideaId", "repoId"],
          },
        },
        {
          name: "get_active_path",
          description: "Get the active phase path from stored cursor state (root → deepest selected phase)",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
            },
            required: ["projectPath"],
          },
        },
        {
          name: "get_prioritized_ideas",
          description: "Start and resume the infinite loop here. Operate through the graph first: pick a high-value actionable idea, update ideas/connections/phases as understanding changes, verify real outcomes, record the result on the idea, then return and reprioritize toward the mission. Do not substitute planning Markdown for graph state. Ranks phase-committed open ideas; if the phase contains only open containers, ranks connected uncommitted open leaves instead (an equal path — work reaches you through parents as well as phases). If no actionable leaf exists anywhere, returns an explicit exploration contract: step back, inspect hygiene/reflections, decompose a mission, or create a bounded hypothesis and experiment in graph state.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              phaseId: { type: "string" },
              limit: { type: "number" },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "list_ideas",
          description: "List all ideas. Filter by status, phaseId, floating (no phase AND no parents — orphans to reparent), or uncommitted (not in any phase). An idea with a parent needs no phase: it already contributes through that parent, so uncommitted is a normal resting state, not a gap. Use uncommitted=true with status=open to browse that backlog; commit_idea_to_phase only what you intend to act on in the phase.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              status: { type: ["string", "array"], items: { type: "string" } },
              phaseId: { type: "string" },
              floating: { type: "boolean" },
              uncommitted: { type: "boolean" },
              limit: { type: "number" },
              offset: { type: "number" },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "check_consistency",
          description: "Check the idea graph for structural issues: broken links, mismatched parent/child references, orphaned embeddings. Run before fix_consistency.",
          inputSchema: {
            type: "object",
            properties: { projectPath: PROJECT_PATH_TOOL_PROPERTY },
            required: ["projectPath"],
          },
        },
        {
          name: "fix_consistency",
          description: "Auto-repair structural inconsistencies found by check_consistency (rewires broken references).",
          inputSchema: {
            type: "object",
            properties: { projectPath: PROJECT_PATH_TOOL_PROPERTY },
            required: ["projectPath"],
          },
        },
        {
          name: "build_search_index",
          description: "Rebuild the text search index and queue background embedding generation for semantic search.",
          inputSchema: {
            type: "object",
            properties: { projectPath: PROJECT_PATH_TOOL_PROPERTY },
            required: ["projectPath"],
          },
        },
        {
          name: "search_ideas_semantic",
          description: "Search ideas by semantic similarity (embedding-based). Requires build_search_index to have run. Useful for finding duplicates.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              query: { type: "string" },
              status: { type: ["string", "array"], items: { type: "string" } },
              phaseId: { type: "string" },
              limit: { type: "number" },
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "find_duplicate_ideas",
          description: "Scan the embedding index for near-duplicate ideas (all-pairs cosine similarity). Returns ranked pairs above `threshold` (default 0.92). Run build_search_index first if results are empty. Use merge_ideas to act on results.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              threshold: { type: "number", description: "Similarity threshold 0–1 (default 0.92)" },
              limit: { type: "number", description: "Max pairs to return (default 50)" },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "suggest_reparents",
          description: "Read-only: for each leaf child of a vague catch-all parent, suggests the closest sub-parent by embedding cosine (default candidates: the catch-all's children that are parents themselves; override with candidateParentIds). Run build_search_index first if empty. Apply with update_idea/merge_ideas.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              parentIdeaId: { type: "string", description: "UUID of the catch-all parent idea" },
              candidateParentIds: { type: "array", items: { type: "string" }, description: "Optional explicit candidate sub-parent UUIDs (default: the catch-all's children that have children)" },
              limit: { type: "number", description: "Max suggestions to return (default 200)" },
            },
            required: ["projectPath", "parentIdeaId"],
          },
        },
        {
          name: "graph_hygiene",
          description: "Read-only dashboard of graph DEFECTS: floating ideas (no phase AND no parents), mega-parents (catch-all smell, >= megaParentThreshold direct children), stale cancelled/failed/human-dependent ideas, collapse candidates (all active children implemented), and duplicate clusters (cosine >= duplicateThreshold; needs build_search_index). Uncommitted ideas are NOT defects — having no phase is a normal state; browse them with list_ideas uncommitted=true. Act via merge_ideas / suggest_reparents / update_idea.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              megaParentThreshold: { type: "number", description: "Min direct children to flag a mega-parent (default 25)" },
              duplicateThreshold: { type: "number", description: "Cosine threshold for duplicate clusters 0–1 (default 0.92)" },
              limit: { type: "number", description: "Max items per section (default 30)" },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "merge_ideas",
          description: "Merge source idea B into target idea A: rewires B's parents, children, and phase commitments onto A (deduplicating), copies B's reflections to A, then archives B. Use after finding duplicates via search_ideas_semantic, or to collapse a redundant child into its parent. Guards against self-merge only; a direct parent-child pair is merged cleanly (the connecting edge is dropped).",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              targetId: { type: "string", description: "UUID of the idea to keep (A)" },
              sourceId: { type: "string", description: "UUID of the idea to archive (B)" },
            },
            required: ["projectPath", "targetId", "sourceId"],
          },
        },
        {
          name: "reconcile_status",
          description: "Read-only: OPEN ideas cited by >= 1 code commit (8-char id prefix in the message; commits touching only .bowman/ don't count), ranked by commit count — likely implemented but never marked. Check each against the code, then update_idea to implemented with a reflection. A parent may be only partially done; a commit citing an idea as future work is a false positive. Needs a git repo.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              limit: { type: "number", description: "Max candidates to return (default 30)" },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "reconcile_code_presence",
          description: "Read-only, noisier complement to reconcile_status: for OPEN ideas no code commit cites, counts how many code-shaped tokens (camelCase/snake_case/dotted/file names) from text+description exist in the codebase (git grep). Ideas >= minScore are flagged as likely implemented, with matched/missing tokens as evidence. Verify against the code before update_idea to implemented. Needs a git repo.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              minScore: { type: "number", description: "Min fraction of an idea's tokens present in code to flag it, 0–1 (default 0.6)" },
              limit: { type: "number", description: "Max candidates to return (default 20)" },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "install_hooks",
          description: "Returns the coding assistant hook installation and setup guide (for Codex continuation hooks, wrapped worker halt notification hooks, installation script usage, and human-wait protocols).",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "enable_continue_hook",
          description: "Turn the Aimparency Stop continuation hook ON for a repository; with agent, first installs it idempotently. Call ONLY when the human explicitly asks to enable/install the hook.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              agent: {
                type: "string",
                enum: [...CONTINUE_HOOK_AGENTS],
                description: "Coding assistant to install the hook for. Omit to only re-enable an already installed hook.",
              },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "disable_continue_hook",
          description: "Turn the Aimparency Stop continuation hook OFF for a repository (per-clone flag, effective from the next Stop, agent config untouched). Call ONLY when the human explicitly asks — never to escape the continuation loop on your own.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
            },
            required: ["projectPath"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (!args) {
        throw new Error("Arguments are required for tool calls");
      }

      switch (name) {
        case "get_idea": {
          const idea = await trpcClient.idea.get.query({
            projectPath: args.projectPath as string,
            ideaId: args.ideaId as string,
          });
          await describeRepoEdges(trpcClient, args.projectPath as string, [idea]);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(formatIdea(idea), null, 2),
              },
            ],
          };
        }

        case "get_idea_context": {
          const ideaId = args.ideaId as string;
          const projectPath = args.projectPath as string;
          const MAX_PATH_DEPTH = 64;
          const MAX_PATHS = 100;

          // Load the whole graph once: it powers the value model (to choose
          // which parent to follow at branches) and lets us resolve parent/child
          // text from a map instead of N round-trips.
          const allIdeas = await trpcClient.idea.list.query({ projectPath });
          const ideaMap = new Map<string, any>((allIdeas as any[]).map((a: any) => [a.id, a]));
          const { flowValues } = calculateIdeaValues(allIdeas as any);

          const idea = ideaMap.get(ideaId) || await trpcClient.idea.get.query({ projectPath, ideaId });

          // Semantic Search
          const queryText = `${idea.text} ${idea.description || ''}`.trim();
          const similarIdeas = await trpcClient.idea.searchSemantic.query({
            projectPath,
            query: queryText,
            limit: 6 // Request 6, filter self
          });
          const semanticContext = similarIdeas
            .filter((a: any) => a.id !== ideaId)
            .slice(0, 5)
            .map((a: any) => ({ id: a.id, text: a.text, description: a.description }));

          // Immediate parents (an idea may have several)
          const parentContext = (idea.supportedIdeas || [])
            .map((id: string) => ideaMap.get(id))
            .filter(Boolean)
            .map((p: any) => ({ id: p.id, text: p.text, description: p.description }));

          // Children
          const childContext = (idea.supportingConnections || [])
            .map((c: any) => ideaMap.get(c.ideaId))
            .filter(Boolean)
            .map((c: any) => ({ id: c.id, text: c.text, description: c.description }));

          // Black-box repo supporters: whole external repos carrying part of
          // this idea. They are not in ideaMap (nothing inside them is loaded, by
          // design), so they would be invisible without this.
          const repoCarrier = { supportingRepos: [...(idea.supportingRepos || [])] };
          await describeRepoEdges(trpcClient, projectPath, [repoCarrier]);
          const repoContext = repoCarrier.supportingRepos;

          // Highest-value path to root: walk up supportedIdeas so the agent sees
          // lineage toward the highest-value goal (e.g. "achieve ASI"). At a
          // branch (multiple parents) follow the one with the highest actual
          // value inflow into the current idea — i.e. the parent through which
          // most value flows here. Cycle-guarded and capped at MAX_PATH.
          const pathToRoot: any[] = [];
          const visited = new Set<string>([ideaId]);
          let cursor: any = idea;
          while (pathToRoot.length < MAX_PATH_DEPTH) {
            const parentIds = (cursor.supportedIdeas || []).filter(
              (id: string) => ideaMap.has(id) && !visited.has(id)
            );
            if (parentIds.length === 0) break; // reached a root (or only cycles remain)

            // Pick the parent with the greatest value inflow into `cursor`.
            let best = parentIds[0];
            let bestFlow = flowValues.get(`${best}->${cursor.id}`) ?? 0;
            for (const pid of parentIds) {
              const flow = flowValues.get(`${pid}->${cursor.id}`) ?? 0;
              if (flow > bestFlow) { best = pid; bestFlow = flow; }
            }

            const parent = ideaMap.get(best);
            visited.add(best);
            pathToRoot.push({
              id: parent.id,
              text: parent.text,
              description: parent.description,
              intrinsicValue: parent.intrinsicValue ?? 0,
              valueInflow: Number(bestFlow.toFixed(4)),
            });
            cursor = parent;
          }
          // Order root-first so the north-star goal reads at the top.
          pathToRoot.reverse();

          // All distinct root paths. Keep a visited set per branch so a node
          // shared by several legitimate paths appears in each, while cycles
          // cannot masquerade as roots. Bounds are explicit in the response.
          const pathsToRoot: any[][] = [];
          let pathsToRootTruncated = false;
          const walkAllParents = (
            current: any,
            upwardPath: any[],
            branchVisited: Set<string>
          ) => {
            if (pathsToRoot.length >= MAX_PATHS) {
              pathsToRootTruncated = true;
              return;
            }
            if (upwardPath.length >= MAX_PATH_DEPTH) {
              pathsToRootTruncated = true;
              return;
            }

            const existingParentIds = (current.supportedIdeas || [])
              .filter((id: string) => ideaMap.has(id));
            if (existingParentIds.length === 0) {
              pathsToRoot.push([...upwardPath].reverse());
              return;
            }

            let followedParent = false;
            for (const parentId of existingParentIds) {
              if (branchVisited.has(parentId)) continue;
              followedParent = true;
              const parent = ideaMap.get(parentId);
              const flow = flowValues.get(`${parentId}->${current.id}`) ?? 0;
              walkAllParents(
                parent,
                [...upwardPath, {
                  id: parent.id,
                  text: parent.text,
                  description: parent.description,
                  intrinsicValue: parent.intrinsicValue ?? 0,
                  valueInflow: Number(flow.toFixed(4)),
                }],
                new Set([...branchVisited, parentId])
              );
            }
            if (!followedParent) {
              // Every branch closes a cycle; this is not a path to a root.
              return;
            }
          };
          walkAllParents(idea, [], new Set([ideaId]));

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                    idea: { id: idea.id, text: idea.text, description: idea.description },
                    path_to_root: pathToRoot,
                    paths_to_root: pathsToRoot,
                    paths_to_root_truncated: pathsToRootTruncated,
                    semantic_context: semanticContext,
                    parents: parentContext,
                    children: childContext,
                    supporting_repos: repoContext
                }, null, 2),
              },
            ],
          };
        }

        case "list_phase_ideas_recursive": {
            // 1. Get all ideas (cache them)
            const allIdeas: any[] = await trpcClient.idea.list.query({
                projectPath: args.projectPath as string,
            });
            const ideaMap = new Map(allIdeas.map((a: any) => [a.id, a]));

            // 2. Fetch the target phase directly
            const phase = await trpcClient.phase.get.query({
                projectPath: args.projectPath as string,
                phaseId: args.phaseId as string,
            });

            const roots = phase.commitments;
            
            // 3. Traverse
            const visited = new Set<string>();
            const result: any[] = [];
            const allowedStatuses = args.status 
                ? (Array.isArray(args.status) ? args.status : [args.status])
                : ['open'];

            function buildTree(ideaId: string): any | null {
                if (visited.has(ideaId)) return null; // Cycle detection
                visited.add(ideaId);

                const idea = ideaMap.get(ideaId);
                if (!idea) return null;

                const children = (idea.supportingConnections || [])
                    .map((conn: any) => buildTree(typeof conn === 'string' ? conn : conn.ideaId))
                    .filter((c: any) => c !== null);

                const node = {
                    id: idea.id,
                    text: idea.text,
                    description: idea.description,
                    status: idea.status.state,
                    children: children
                };

                const isOpen = (allowedStatuses as string[]).includes(idea.status.state);
                const hasOpenChildren = children.length > 0;

                // Keep if open OR has open children (so we can see the path to the open child)
                if (isOpen || hasOpenChildren) {
                    return node;
                }
                return null;
            }

            for (const rootId of roots) {
                const tree = buildTree(rootId);
                if (tree) result.push(tree);
            }

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(result, null, 2)
                }]
            };
        }

        case "search_ideas": {
          const ideas = await trpcClient.idea.search.query({
            projectPath: args.projectPath as string,
            query: args.query as string,
            status: args.status as string | string[] | undefined,
            phaseId: args.phaseId as string | undefined,
            archived: args.archived as boolean | undefined,
            limit: args.limit as number | undefined,
            offset: args.offset as number | undefined,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(formatIdeas(ideas), null, 2),
              },
            ],
          };
        }

        case "list_phases": {
          const phases = await trpcClient.phase.list.query({
            projectPath: args.projectPath as string,
            parentPhaseId: args.parentPhaseId as string | undefined,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(phases, null, 2),
              },
            ],
          };
        }

        case "search_phases": {
          const phases = await trpcClient.phase.search.query({
            projectPath: args.projectPath as string,
            query: args.query as string,
            parentPhaseId: args.parentPhaseId as string | undefined,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(phases, null, 2),
              },
            ],
          };
        }

        case "create_idea": {
          if (args.cost !== undefined && (!Number.isFinite(args.cost) || (args.cost as number) <= 0)) {
            throw new Error("Estimated direct cost must be a finite number greater than 0.");
          }
          if (args.duration !== undefined && (!Number.isFinite(args.duration) || (args.duration as number) < 0)) {
            throw new Error("Duration must be a finite number greater than or equal to 0 days.");
          }
          const expectedToken = ideaCreationConfirmationToken(args);
          if (args.confirmationToken === undefined) {
            const related = await trpcClient.idea.search.query({
              projectPath: args.projectPath as string,
              query: args.text as string,
              limit: 8,
            });
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  created: false,
                  reviewRequired: true,
                  confirmationToken: expectedToken,
                  instruction:
                    "Review the related ideas, especially cancelled ones and their reasons. " +
                    "Reuse, update, connect, or merge when appropriate. If this proposal is still distinct and useful, " +
                    "repeat the identical create_idea call with confirmationToken.",
                  relatedIdeas: (related as any[]).map((idea: any) => ({
                    id: idea.id,
                    text: idea.text,
                    description: idea.description,
                    status: idea.status,
                    score: idea.score,
                  })),
                }, null, 2),
              }],
            };
          }
          if (args.confirmationToken !== expectedToken) {
            throw new Error(
              "confirmationToken does not match this idea proposal. " +
              "Call create_idea again without confirmationToken to review context for the edited proposal.",
            );
          }

          const result = await trpcClient.idea.createFloatingIdea.mutate({
            projectPath: args.projectPath as string,
            idea: {
              text: args.text as string,
              description: args.description as string | undefined,
              tags: args.tags as string[] | undefined,
              status: (args.status as any) || {
                state: "open",
                comment: "",
                date: Date.now(),
              },
              intrinsicValue: args.intrinsicValue as number | undefined,
              valueRationale: args.valueRationale as string | undefined,
              cost: args.cost as number | undefined,
              duration: args.duration as number | undefined,
            },
          });

          // Handle supportingConnections (children)
          const children = (args.supportingConnections as ConnectionInput[]) || [];
          for (const childInput of children) {
            const child = normalizeConnectionInput(childInput);
            await trpcClient.idea.connectIdeas.mutate({
              projectPath: args.projectPath as string,
              parentIdeaId: result.id,
              childIdeaId: child.ideaId,
              weight: child.weight,
              explanation: child.explanation,
            });
          }

          // Handle supportedIdeas (parents)
          const parents = (args.supportedIdeas as ConnectionInput[]) || [];
          for (const parentInput of parents) {
            const parent = normalizeConnectionInput(parentInput);
            await trpcClient.idea.connectIdeas.mutate({
              projectPath: args.projectPath as string,
              parentIdeaId: parent.ideaId,
              childIdeaId: result.id,
              weight: parent.weight,
              explanation: parent.explanation,
            });
          }

          // If phaseId provided, commit to phase
          if (args.phaseId) {
            await trpcClient.idea.commitToPhase.mutate({
              projectPath: args.projectPath as string,
              ideaId: result.id,
              phaseId: args.phaseId as string,
            });
          }

          return {
            content: [
              {
                type: "text",
                text: `Created idea with ID: ${result.id}${args.phaseId ? ` and committed to phase ${args.phaseId}` : ''}`,
              },
            ],
          };
        }

        case "update_idea": {
          const updateData: any = {};
          if (args.text) updateData.text = args.text;
          if (args.description !== undefined) updateData.description = args.description;
          if (args.reflection !== undefined) updateData.reflection = args.reflection;
          if (args.tags) updateData.tags = args.tags;
          if (args.status) updateData.status = args.status;
          if (args.intrinsicValue !== undefined) updateData.intrinsicValue = args.intrinsicValue;
          if (args.valueRationale !== undefined) updateData.valueRationale = args.valueRationale;
          if (args.cost !== undefined) updateData.cost = args.cost;
          if (args.duration !== undefined) updateData.duration = args.duration;

          const parentMetadataToApply: Array<{ parentIdeaId: string; weight?: number; explanation?: string }> = [];

          if (args.addSupportingConnections !== undefined || args.removeSupportingConnections !== undefined ||
              args.addSupportedIdeas !== undefined || args.removeSupportedIdeas !== undefined) {
            const existingIdea = await trpcClient.idea.get.query({
              projectPath: args.projectPath as string,
              ideaId: args.ideaId as string,
            });

            if (args.addSupportingConnections !== undefined || args.removeSupportingConnections !== undefined) {
              const byChildId = new Map<string, any>();
              for (const conn of existingIdea.supportingConnections ?? []) {
                byChildId.set(conn.ideaId, { ...conn });
              }
              for (const childId of (args.removeSupportingConnections as string[] | undefined) ?? []) {
                byChildId.delete(childId);
              }
              for (const input of (args.addSupportingConnections as ConnectionInput[] | undefined) ?? []) {
                const next = toStoredConnection(input);
                byChildId.set(next.ideaId, { ...(byChildId.get(next.ideaId) ?? {}), ...next });
              }
              updateData.supportingConnections = Array.from(byChildId.values());
            }

            if (args.addSupportedIdeas !== undefined || args.removeSupportedIdeas !== undefined) {
              const parentIds = new Set<string>(existingIdea.supportedIdeas ?? []);
              for (const parentId of (args.removeSupportedIdeas as string[] | undefined) ?? []) {
                parentIds.delete(parentId);
              }
              for (const input of (args.addSupportedIdeas as ConnectionInput[] | undefined) ?? []) {
                const parent = normalizeConnectionInput(input);
                parentIds.add(parent.ideaId);
                if (typeof input !== "string") {
                  parentMetadataToApply.push({ parentIdeaId: parent.ideaId, weight: parent.weight, explanation: parent.explanation });
                }
              }
              updateData.supportedIdeas = Array.from(parentIds);
            }
          }

          await trpcClient.idea.update.mutate({
            projectPath: args.projectPath as string,
            ideaId: args.ideaId as string,
            idea: updateData,
          });

          for (const parent of parentMetadataToApply) {
            if (parent.weight === undefined && parent.explanation === undefined) continue;

            const parentIdea = await trpcClient.idea.get.query({
              projectPath: args.projectPath as string,
              ideaId: parent.parentIdeaId,
            });
            const childIdeaId = args.ideaId as string;
            const supportingConnections = [...(parentIdea.supportingConnections ?? [])];
            const existingIndex = supportingConnections.findIndex((conn: any) => conn.ideaId === childIdeaId);
            const previous = existingIndex === -1 ? { ideaId: childIdeaId } : supportingConnections[existingIndex];
            const next = {
              ...previous,
              ideaId: childIdeaId,
              relativePosition: previous.relativePosition ?? [0, 0],
              weight: parent.weight ?? previous.weight ?? 1,
              ...(parent.explanation !== undefined ? { explanation: parent.explanation } : {}),
            };
            if (existingIndex === -1) {
              supportingConnections.push(next);
            } else {
              supportingConnections[existingIndex] = next;
            }
            await trpcClient.idea.update.mutate({
              projectPath: args.projectPath as string,
              ideaId: parent.parentIdeaId,
              idea: { supportingConnections },
            });
          }

          // Verification gate (soft): closing an idea should mean verified-done,
          // not claimed-done. When status is set to implemented without any reflection
          // recording evidence, nudge the agent to addReflection. Non-blocking
          // and best-effort — never fails the update.
          let verificationNudge = "";
          if ((args.status as any)?.state === "implemented") {
            try {
              const idea = await trpcClient.idea.get.query({
                projectPath: args.projectPath as string,
                ideaId: args.ideaId as string,
              });
              const hasReflection =
                (typeof idea?.reflection === "string" && idea.reflection.trim().length > 0) ||
                (Array.isArray(idea?.reflections) && idea.reflections.length > 0);
              if (!hasReflection) {
                verificationNudge =
                  "\n\nReminder: marked implemented without a reflection. Record the verification evidence in update_idea.reflection or addReflection — " +
                  verificationHintForIdea(idea) +
                  " — so the graph reflects verified-done rather than claimed-done.";
              }
            } catch {
              // best-effort: a failed lookup must not break the update
            }
          }

          return {
            content: [
              {
                type: "text",
                text: `Updated idea ${args.ideaId}${verificationNudge}`,
              },
            ],
          };
        }

        case "delete_idea": {
          await trpcClient.idea.delete.mutate({
            projectPath: args.projectPath as string,
            ideaId: args.ideaId as string,
          });
          return {
            content: [
              {
                type: "text",
                text: `Deleted idea ${args.ideaId}`,
              },
            ],
          };
        }

        case "addReflection": {
          const result = await trpcClient.idea.addReflection.mutate({
            projectPath: args.projectPath as string,
            ideaId: args.ideaId as string,
            reflection: args.reflection as any,
          });
          return {
            content: [
              {
                type: "text",
                text: `Added reflection to idea ${args.ideaId}`,
              },
            ],
          };
        }

        case "create_phase": {
          const parent = (args.parent as string | null | undefined) ?? null;
          const hasPlacement =
            args.order !== undefined || args.before !== undefined || args.after !== undefined;
          const siblings = hasPlacement
            ? await trpcClient.phase.list.query({
                projectPath: args.projectPath as string,
                parentPhaseId: parent,
              })
            : [];
          const resolvedOrder = resolvePhasePlacement(
            {
              order: args.order as number | undefined,
              before: args.before as string | undefined,
              after: args.after as string | undefined,
            },
            siblings as PhaseSibling[],
          );
          const result = await trpcClient.phase.create.mutate({
            projectPath: args.projectPath as string,
            phase: {
              name: args.name as string,
              parent,
              ...(resolvedOrder !== undefined ? { order: resolvedOrder } : {}),
              ...(args.from !== undefined ? { from: args.from as number } : {}),
              ...(args.to !== undefined ? { to: args.to as number } : {}),
              commitments: [],
            },
          });
          return {
            content: [
              {
                type: "text",
                text: `Created phase with ID: ${result.id}` +
                  (resolvedOrder !== undefined ? ` at sibling index ${resolvedOrder}` : ""),
              },
            ],
          };
        }

        case "update_phase": {
          const updateData: any = {};
          if (args.name !== undefined) updateData.name = args.name;
          if (args.parent !== undefined) updateData.parent = args.parent;
          if (args.from !== undefined) updateData.from = args.from;
          if (args.to !== undefined) updateData.to = args.to;

          await trpcClient.phase.update.mutate({
            projectPath: args.projectPath as string,
            phaseId: args.phaseId as string,
            phase: updateData,
          });
          return {
            content: [
              {
                type: "text",
                text: `Updated phase ${args.phaseId}`,
              },
            ],
          };
        }

        case "delete_phase": {
          await trpcClient.phase.delete.mutate({
            projectPath: args.projectPath as string,
            phaseId: args.phaseId as string,
          });
          return {
            content: [
              {
                type: "text",
                text: `Deleted phase ${args.phaseId}`,
              },
            ],
          };
        }

        case "commit_idea_to_phase": {
          await trpcClient.idea.commitToPhase.mutate({
            projectPath: args.projectPath as string,
            ideaId: args.ideaId as string,
            phaseId: args.phaseId as string,
            insertionIndex: args.insertionIndex as number | undefined,
          });
          return {
            content: [
              {
                type: "text",
                text: `Committed idea ${args.ideaId} to phase ${args.phaseId}`,
              },
            ],
          };
        }

        case "list_linked_repos": {
          const repos = await trpcClient.linkedRepo.list.query({
            projectPath: args.projectPath as string,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  (repos as any[]).map((r: any) => ({
                    repoId: r.repoId,
                    name: r.name,
                    ...(r.url ? { url: r.url } : {}),
                    resolved: r.resolved,
                    ...(r.localPath ? { localPath: r.localPath } : {}),
                  })),
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "register_linked_repo": {
          const repo = await trpcClient.linkedRepo.register.mutate({
            projectPath: args.projectPath as string,
            targetPath: args.targetPath as string,
            url: args.url as string | undefined,
            access: (args.access as "read" | "write" | undefined) ?? "read",
          });
          return {
            content: [
              {
                type: "text",
                text: `Registered linked repo "${repo.name}" (${repo.repoId}). Use link_repo with that repoId to attach it to an idea.`,
              },
            ],
          };
        }

        case "link_repo": {
          const projectPath = args.projectPath as string;
          const repoId = args.repoId as string;

          // Fail loudly on an unregistered repoId: idea.linkRepo would happily
          // store an edge pointing at nothing, which renders as a nameless
          // black box and silently drains value into a dead sink.
          const repos = await trpcClient.linkedRepo.list.query({ projectPath });
          const repo = (repos as any[]).find((r: any) => r.repoId === repoId);
          if (!repo) {
            const known = (repos as any[]).map((r: any) => `${r.repoId} (${r.name})`).join(", ") || "none";
            throw new Error(
              `Repo ${repoId} is not in this project's linked-repo registry. Register it first with register_linked_repo. Known repos: ${known}`
            );
          }

          await trpcClient.idea.linkRepo.mutate({
            projectPath,
            ideaId: args.ideaId as string,
            repoId,
            weight: args.weight as number | undefined,
            explanation: args.explanation as string | undefined,
          });
          return {
            content: [
              {
                type: "text",
                text: `Linked idea ${args.ideaId} to repo "${repo.name}" (${repoId})${repo.resolved ? "" : " — note: that repo is not checked out on this machine, so it renders as an unresolved stub"}`,
              },
            ],
          };
        }

        case "unlink_repo": {
          await trpcClient.idea.unlinkRepo.mutate({
            projectPath: args.projectPath as string,
            ideaId: args.ideaId as string,
            repoId: args.repoId as string,
          });
          return {
            content: [
              {
                type: "text",
                text: `Unlinked repo ${args.repoId} from idea ${args.ideaId}`,
              },
            ],
          };
        }

        case "remove_idea_from_phase": {
          await trpcClient.idea.removeFromPhase.mutate({
            projectPath: args.projectPath as string,
            ideaId: args.ideaId as string,
            phaseId: args.phaseId as string,
          });
          return {
            content: [
              {
                type: "text",
                text: `Removed idea ${args.ideaId} from phase ${args.phaseId}`,
              },
            ],
          };
        }

        case "get_active_path": {
          const result = await trpcClient.phase.getActivePath.query({
            projectPath: args.projectPath as string,
          });
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                path: result.path.map((p: any) => ({ id: p.id, name: p.name, parent: p.parent })),
                activeLevel: result.activeLevel,
                activePhase: result.activePhase ? { id: result.activePhase.id, name: result.activePhase.name } : null,
              }, null, 2),
            }],
          };
        }

        case "get_prioritized_ideas": {
          // Fetch all phases once; we need them for both explicit lookup and time-based resolution.
          // parentPhaseId omitted → backend returns all phases
          const allPhases: any[] = await trpcClient.phase.list.query({
            projectPath: args.projectPath as string,
          });
          const phaseById = new Map<string, any>(allPhases.map((p: any) => [p.id, p]));
          // Reported once here instead of in every tool description: what cost estimates mean in this project.
          const projectMeta: any = await trpcClient.project.getMeta.query({ projectPath: args.projectPath as string }).catch(() => null);

          let targetPhase: any = null;

          if (args.phaseId) {
            targetPhase = phaseById.get(args.phaseId as string) ?? null;
          }

          if (!targetPhase) {
            // Time-based resolution: find the deepest currently-active leaf phase
            // that has open commitments. "phaseCursors" in meta.json can be stale
            // or store indices rather than UUIDs, so we don't rely on it.
            const now = Date.now();
            const activePhases = allPhases.filter(
              (p: any) => p.from > 0 && p.to > 0 && p.from <= now && now <= p.to
            );

            // Build a helper: is this phase a leaf (no children, or all children are inactive)?
            const hasActiveChild = (phase: any): boolean =>
              (phase.childPhaseIds ?? []).some((cid: string) => {
                const child = phaseById.get(cid);
                return child && child.from > 0 && child.to > 0 && child.from <= now && now <= child.to;
              });

            // Prefer deepest active leaf with open commitments; fall back up the tree.
            const leaves = activePhases.filter((p: any) => !hasActiveChild(p));
            const candidates = leaves.length > 0 ? leaves : activePhases;

            // Walk up from each candidate until we find one with commitments.
            const findWithCommitments = (phase: any): any => {
              if (!phase) return null;
              if ((phase.commitments ?? []).length > 0) return phase;
              const parent = phaseById.get(phase.parent);
              return findWithCommitments(parent);
            };

            for (const leaf of candidates) {
              const found = findWithCommitments(leaf);
              if (found) { targetPhase = found; break; }
            }
          }

          if (!targetPhase) {
            return { content: [{ type: "text", text: "No active phase found. Use list_phases to find a phase and pass phaseId." }] };
          }

          // Run the full-graph economic model so value flows top-down from
          // high-value goals (e.g. ASI) into the sub-ideas that support them and
          // cost aggregates bottom-up. Ranking a single idea by its own
          // intrinsicValue/cost ignores the graph and is near-useless when most
          // intrinsic value sits at the top.
          const allIdeas = await trpcClient.idea.list.query({
            projectPath: args.projectPath as string,
          });
          const { priorities, values, costs, totalIntrinsic } = calculateIdeaValues(allIdeas as any);

          const ideaIdSet = new Set<string>(targetPhase.commitments ?? []);
          const openInPhase = (allIdeas as any[]).filter(
            (a: any) => ideaIdSet.has(a.id) && a.status.state === 'open'
          );
          const hasActiveChild = (idea: any) => (idea.supportingConnections ?? []).some((connection: any) => {
            const child = (allIdeas as any[]).find((candidate: any) => candidate.id === connection.ideaId);
            return child && ['open', 'partially'].includes(child.status?.state);
          });
          const openLeavesInPhase = openInPhase.filter((idea: any) => !hasActiveChild(idea));
          const uncommittedLeaves = openLeavesInPhase.length === 0
            ? (allIdeas as any[]).filter((idea: any) =>
                idea.status?.state === 'open'
                && (idea.committedIn ?? []).length === 0
                && (idea.supportedIdeas ?? []).length > 0
                && !hasActiveChild(idea)
              )
            : [];
          const rankedOpenIdeas = uncommittedLeaves.length > 0
            ? uncommittedLeaves
            : openInPhase;
          const emptyActionableFrontier = openLeavesInPhase.length === 0 && uncommittedLeaves.length === 0;
          const selectionScope = uncommittedLeaves.length > 0
            ? 'connected-uncommitted-leaves'
            : emptyActionableFrontier
              ? 'mission-containers-exploration'
              : 'phase-commitments';

          // Diagnostics: how many committed ideas are missing economic data
          const allCommitted = (allIdeas as any[]).filter((a: any) => ideaIdSet.has(a.id));
          // An idea with effectively-zero flowed value is disconnected from any intrinsic
          // value source in the graph — its priority is meaningless regardless of cost.
          const missingValue = allCommitted.filter(
            (a: any) => (values.get(a.id) ?? 0) < 1e-10
          ).length;

          const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : (n > 0 ? "Infinity" : "-Infinity"));

          // Phase-level economic summary
          const phaseFlowedValue = allCommitted.reduce(
            (sum, a) => sum + (values.get(a.id) ?? 0) * totalIntrinsic, 0
          );
          const phaseTotalCost = allCommitted.reduce(
            (sum, a) => sum + (costs.get(a.id) ?? 0), 0
          );
          const phaseValueFraction = totalIntrinsic > 0
            ? phaseFlowedValue / totalIntrinsic
            : 0;

          // Realized-cost signal: real commits referencing each open idea = actual
          // output. Grounds attention in reality (which ranked ideas have actually
          // produced work) without mutating the human-set value model.
          const commitMessages = getRepoCommitMessages(args.projectPath as string);
          const realized = countIdeaReferences(commitMessages, rankedOpenIdeas.map((a: any) => a.id));
          const realizedSignalAvailable = commitMessages.length > 0;
          // High-priority ideas with a real cost but zero realized output are the
          // ones the loop keeps ranking yet never actually advances — surface them.
          const noRealizedOutput = realizedSignalAvailable
            ? rankedOpenIdeas.filter((a: any) => (a.cost ?? 0) > 0 && !(realized.get(a.id) ?? 0)).length
            : 0;

          const prioritized = rankedOpenIdeas
            .map((a: any) => ({
              ...a,
              _priority: priorities.get(a.id) ?? 0,
              _flowedValue: (values.get(a.id) ?? 0) * totalIntrinsic,
              _aggregatedCost: costs.get(a.id) ?? 0,
              _realizedCommits: realized.get(a.id) ?? 0,
            }))
            .sort((a: any, b: any) => b._priority - a._priority)
            .slice(0, (args.limit as number) || 10);

          // Build phase path for context
          const phasePath: string[] = [];
          let cur: any = targetPhase;
          while (cur) {
            phasePath.unshift(cur.name);
            cur = phaseById.get(cur.parent);
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  phasePath,
                  phase: targetPhase.name,
                  selectionScope,
                  model: "flow-based (top-down estimated value, bottom-up estimated cost, discounted value/cost profitability ratio)",
                  economics: {
                    costUnit: projectMeta?.costUnit || "abstract units",
                    defaultCost: defaultIdeaCost(projectMeta),
                    phaseFlowedValue: fmt(phaseFlowedValue),
                    phaseTotalCost: fmt(phaseTotalCost),
                    phaseValueFraction: (phaseValueFraction * 100).toFixed(1) + "%",
                    totalGraphIntrinsicValue: totalIntrinsic,
                  },
                  diagnostics: {
                    committedIdeas: allCommitted.length,
                    openIdeas: openInPhase.length,
                    openLeafIdeas: openLeavesInPhase.length,
                    uncommittedLeafIdeas: uncommittedLeaves.length,
                    disconnectedFromValue: missingValue,
                    realizedSignal: realizedSignalAvailable ? "git-commit-references" : "unavailable (not a git repo / no commits)",
                    openIdeasWithNoRealizedOutput: realizedSignalAvailable ? noRealizedOutput : undefined,
                    note: uncommittedLeaves.length > 0
                      ? `No open leaf idea is committed to this phase; ranked ${uncommittedLeaves.length} connected uncommitted open leaf idea(s) instead. They are reachable through their parents — rank and work them as they are; committing them to a phase is optional.`
                      : emptyActionableFrontier
                      ? "No open actionable leaf exists in the phase or connected uncommitted graph. Mission containers are context for exploration, not executable work."
                      : missingValue > 0
                      ? `${missingValue} idea(s) have zero flowed value — they are disconnected from any intrinsic value source in the graph. Their priorities are unreliable.`
                      : "All committed ideas have economic data.",
                  },
                  exploration: emptyActionableFrontier ? {
                    required: true,
                    objective: "Create or uncover the next valuable actionable leaf in Aimparency graph state before implementing.",
                    moves: [
                      "Inspect graph_hygiene and recent reflections for structural or learned opportunities.",
                      "Step back from the most recent scope and decompose a high-value abstract non-done mission into a bounded leaf.",
                      "Dream up a falsifiable hypothesis with a safe reversible experiment, explicit verification, and stop condition.",
                      "Search before create_idea; connect genuinely new work to the mission and commit it to the active phase.",
                      "Do not manufacture low-value activity or substitute Markdown planning for graph state."
                    ]
                  } : undefined,
                  ideas: prioritized.map((a: any) => ({
                    id: a.id,
                    text: a.text,
                    description: a.description,
                    priority: fmt(a._priority),
                    flowedValue: fmt(a._flowedValue),
                    aggregatedCost: fmt(a._aggregatedCost),
                    realizedCommits: a._realizedCommits,
                    intrinsicValue: a.intrinsicValue,
                    rawCost: a.cost,
                    status: a.status?.state,
                  })),
                }, null, 2),
              },
            ],
          };
        }

        case "list_ideas": {
          const ideas = await trpcClient.idea.list.query({
            projectPath: args.projectPath as string,
            status: args.status as string | string[] | undefined,
            phaseId: args.phaseId as string | undefined,
            floating: args.floating as boolean | undefined,
            uncommitted: args.uncommitted as boolean | undefined,
            limit: args.limit as number | undefined,
            offset: args.offset as number | undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(ideas.map(formatIdea), null, 2) }],
          };
        }

        case "check_consistency": {
          const result = await trpcClient.project.checkConsistency.query({
            projectPath: args.projectPath as string,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "fix_consistency": {
          const result = await trpcClient.project.fixConsistency.mutate({
            projectPath: args.projectPath as string,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "build_search_index": {
          const result = await trpcClient.project.buildSearchIndex.mutate({
            projectPath: args.projectPath as string,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "search_ideas_semantic": {
          const results = await trpcClient.idea.searchSemantic.query({
            projectPath: args.projectPath as string,
            query: args.query as string,
            status: args.status as string | string[] | undefined,
            phaseId: args.phaseId as string | undefined,
            limit: args.limit as number | undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(results.map(formatIdea), null, 2) }],
          };
        }

        case "find_duplicate_ideas": {
          const result = await trpcClient.project.findDuplicates.query({
            projectPath: args.projectPath as string,
            threshold: args.threshold as number | undefined,
            limit: args.limit as number | undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "suggest_reparents": {
          const result = await trpcClient.project.suggestReparents.query({
            projectPath: args.projectPath as string,
            parentIdeaId: args.parentIdeaId as string,
            candidateParentIds: args.candidateParentIds as string[] | undefined,
            limit: args.limit as number | undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "graph_hygiene": {
          const result = await trpcClient.project.graphHygiene.query({
            projectPath: args.projectPath as string,
            megaParentThreshold: args.megaParentThreshold as number | undefined,
            duplicateThreshold: args.duplicateThreshold as number | undefined,
            limit: args.limit as number | undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "merge_ideas": {
          const result = await trpcClient.idea.merge.mutate({
            projectPath: args.projectPath as string,
            targetId: args.targetId as string,
            sourceId: args.sourceId as string,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "reconcile_status": {
          const limit = (args.limit as number | undefined) ?? 30;
          const allIdeas = await trpcClient.idea.list.query({
            projectPath: args.projectPath as string,
          });
          const openIdeas = (allIdeas as any[]).filter((a: any) => a.status?.state === "open");
          // Code-only: a graph-bookkeeping commit that merely cites an idea id is
          // not evidence the idea was implemented (see CODE_ONLY_PATHSPEC).
          const commitMessages = getRepoCommitMessages(args.projectPath as string, 2000, CODE_ONLY_PATHSPEC);
          const counts = countIdeaReferences(commitMessages, openIdeas.map((a: any) => a.id));
          const candidates = findReconciliationCandidates(openIdeas as any[], counts);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                gitAvailable: commitMessages.length > 0,
                openIdeas: openIdeas.length,
                candidatesFound: candidates.length,
                note: commitMessages.length === 0
                  ? "No git commits found (not a git repo, or no history) — commit-reference reconciliation is unavailable."
                  : candidates.length === 0
                    ? "No open ideas are referenced by commits. Either the graph is in sync or commits don't cite idea ids."
                    : "Each candidate is an OPEN idea cited by a commit — verify against the code, then update_idea to implemented with a reflection if confirmed.",
                candidates: candidates.slice(0, limit),
              }, null, 2),
            }],
          };
        }

        case "reconcile_code_presence": {
          const minScore = (args.minScore as number | undefined) ?? 0.6;
          const limit = (args.limit as number | undefined) ?? 20;
          const MAX_TOKENS_PER_IDEA = 12;
          const MAX_UNIQUE_TOKENS = 400;

          const allIdeas = await trpcClient.idea.list.query({ projectPath: args.projectPath as string });
          const openIdeas = (allIdeas as any[]).filter((a: any) => a.status?.state === "open");

          // Ideas already cited by a code commit are reconcile_status's job — skip
          // them so this heuristic focuses on its complement (no commit reference).
          const codeCommits = getRepoCommitMessages(args.projectPath as string, 2000, CODE_ONLY_PATHSPEC);
          const cited = countIdeaReferences(codeCommits, openIdeas.map((a: any) => a.id));
          const ideasToScan = openIdeas.filter((a: any) => !((cited.get(a.id) ?? 0) > 0));

          const tokensByIdea = new Map<string, string[]>();
          const uniqueTokens = new Set<string>();
          for (const a of ideasToScan) {
            const toks = extractCodeTokens(`${a.text}\n${a.description ?? ""}`).slice(0, MAX_TOKENS_PER_IDEA);
            if (toks.length >= 2) {
              tokensByIdea.set(a.id, toks);
              for (const t of toks) if (uniqueTokens.size < MAX_UNIQUE_TOKENS) uniqueTokens.add(t);
            }
          }

          // One git grep per unique token; build the set present in code.
          const present = new Set<string>();
          for (const tok of uniqueTokens) if (gitGrepMatches(args.projectPath as string, tok)) present.add(tok);

          const ideaById = new Map<string, any>(openIdeas.map((a: any) => [a.id, a]));
          const candidates = [...tokensByIdea.entries()]
            .map(([id, toks]) => ({ id, ...scoreCodePresence(toks, present) }))
            .filter((c) => c.scorable && c.score >= minScore && c.matched.length >= 2)
            .sort((x, y) => y.score - x.score)
            .map((c) => ({
              id: c.id,
              text: ideaById.get(c.id)?.text,
              score: Number(c.score.toFixed(2)),
              matched: c.matched,
              missing: c.missing,
            }));

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                openIdeas: openIdeas.length,
                skippedCommitCited: openIdeas.length - ideasToScan.length,
                scanned: tokensByIdea.size,
                minScore,
                candidatesFound: candidates.length,
                note: "OPEN ideas whose code-shaped tokens are mostly present in the codebase — likely already implemented. Heuristic/noisy (a token can exist for unrelated reasons): verify each against the code using the matched/missing tokens, then update_idea to implemented if confirmed. Ideas cited by a code commit are handled by reconcile_status and skipped here.",
                candidates: candidates.slice(0, limit),
              }, null, 2),
            }],
          };
        }

        case "install_hooks": {
          const guide = `# Aimparency Coding Assistant Hook Installation & Setup Guide

## Overview

Aimparency provides lifecycle hooks for coding assistants (Codex, Claude Code, Antigravity / AGY) to enable autonomous continuation through the Aimparency MCP idea graph loop.

There are two separate hook mechanisms:
- \`codex-continue-on-stop.sh\` (in \`scripts/hooks/\`): Blocks a coding assistant's stop event (Codex / Claude Code \`Stop\` or AGY \`post_invocation\`) and starts another autonomous turn driven by the Aimparency MCP graph.
- \`wrapped-worker-halt-notify.sh\` (in \`packages/wrapped-agents/common/hooks/\`): Notifies a running wrapped-agent watchdog that its worker finished a turn (does not continue an ordinary conversation).

---

## Installing Continuation Hook in a Target Repository

### Prerequisites
- Target directory must be a Git repository root.
- Target directory must contain an initialized \`.bowman/\` directory.

### Installation Command

Run the installer from the Aimparency repository:
\`\`\`bash
# For Codex (.codex/hooks.json):
./scripts/hooks/install.sh --target /path/to/project --agent codex

# For Claude Code (.claude/settings.json):
./scripts/hooks/install.sh --target /path/to/project --agent claude

# For Antigravity / AGY (.gemini/settings.json):
./scripts/hooks/install.sh --target /path/to/project --agent agy
\`\`\`

### What the Installer Does
1. Verifies the target is a Git root containing \`.bowman/\`.
2. Copies \`codex-continue-on-stop.sh\` to \`<target>/scripts/hooks/\`.
3. Idempotently merges a single managed continuation handler into \`<target>/.codex/hooks.json\` (Codex), \`<target>/.claude/settings.json\` (Claude Code) or \`<target>/.gemini/settings.json\` (AGY), preserving existing hooks.
4. Makes the script executable (\`chmod +x\`).
5. Validates JSON format and runs blocking/non-blocking smoke tests from a nested directory.

### Post-Installation Setup
1. Restart the coding assistant (Codex, Claude Code or AGY) in the target repository so it reloads project hooks.
2. For Codex, run \`/hooks\` and trust \`scripts/hooks/codex-continue-on-stop.sh\`. For Claude Code, check \`/hooks\` lists the Stop hook. For AGY, verify \`.gemini/settings.json\` \`post_invocation\` hook.
3. Verify that the Aimparency MCP is connected and has access to the target's \`.bowman/\` graph.

---

## Autonomous Continuation & Human-Wait Protocol

### Graph Loop (Normal Continuation)
When the coding assistant attempts to stop normally, the hook blocks the stop event and instructs the assistant to:
1. Call \`get_prioritized_ideas\`
2. Orient with \`get_idea_context\`
3. Implement and verify the selected actionable idea
4. Record evidence and status with \`update_idea\` or \`addReflection\`
5. Reprioritize and continue

### Two-Stage Human-Wait Protocol
If the assistant determines human intervention (credentials, explicit authorization, human judgment) is indispensable:
1. The assistant states the exact blocker and ends its response with \`[AIMPARENCY_REQUEST_HUMAN]\`.
2. The hook challenges the assistant once: stepping back to check graph hygiene, decompose abstract ideas, or find safe reversible work.
3. If human action is still strictly required, the assistant re-states the request and ends with \`[AIMPARENCY_CONFIRM_HUMAN_BLOCK]\`. The hook then yields to the human.

### Enable / Disable
Use the \`enable_continue_hook\` / \`disable_continue_hook\` tools (or the \`enable-hook\` / \`disable-hook\` prompts) only when the human asks. Disabling writes a per-clone flag (\`$(git rev-parse --git-path aimparency-continue-disabled)\`) checked on every Stop — no hook-config reload needed.

### Deliberate Exit
To allow the coding assistant to exit normally without triggering continuation:
\`\`\`bash
AIMPARENCY_ALLOW_STOP=1 codex
# or for Claude Code:
AIMPARENCY_ALLOW_STOP=1 claude
# or for AGY:
AIMPARENCY_ALLOW_STOP=1 agy
\`\`\`

---

## Testing & Verification

To verify hook contract integrity locally:
\`\`\`bash
npm run test:hooks
\`\`\``;

          return {
            content: [{
              type: "text",
              text: guide,
            }],
          };
        }

        case "enable_continue_hook": {
          const text = enableContinueHook(args.projectPath as string, args.agent as string | undefined);
          return { content: [{ type: "text", text }] };
        }

        case "disable_continue_hook": {
          const text = disableContinueHook(args.projectPath as string);
          return { content: [{ type: "text", text }] };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error executing ${name}: ${errorMessage}\n\nPlease check that:\n1. The projectPath is correct and absolute\n2. All UUIDs are valid and exist\n3. The backend server is running on ws://localhost:${process.env.PORT_BACKEND_WS || '3001'}`,
          },
        ],
        isError: true,
      };
    }
  });
}
