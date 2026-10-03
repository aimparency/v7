import { PROJECT_PATH_TOOL_PROPERTY } from "../constants.js";
import type { BackendInputs } from "../client.js";
import type { ToolDefinition } from "./types.js";

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

export const phaseTools: ToolDefinition[] = [
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
    handler: async (args, trpcClient) => {
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
    handler: async (args, trpcClient) => {
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
    handler: async (args, trpcClient) => {
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
    handler: async (args, trpcClient) => {
      const fields = args as BackendInputs["phase"]["update"]["phase"];
      const updateData: BackendInputs["phase"]["update"]["phase"] = {};
      if (fields.name !== undefined) updateData.name = fields.name;
      if (fields.parent !== undefined) updateData.parent = fields.parent;
      if (fields.from !== undefined) updateData.from = fields.from;
      if (fields.to !== undefined) updateData.to = fields.to;

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
    handler: async (args, trpcClient) => {
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
    handler: async (args, trpcClient) => {
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
    handler: async (args, trpcClient) => {
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
    },
  },
];
