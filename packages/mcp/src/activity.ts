import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { IdeaAccessKind } from "shared";
import type { BackendClient } from "./client.js";

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;

// Read tools and what showing an idea in their answer counts as. The idea a
// tool was asked about (args.ideaId) counts as an explicit read. Writes need no
// entry: the backend sees every change itself.
const RESULT_ACCESS: Record<string, IdeaAccessKind> = {
  get_idea: "contextRead",
  get_idea_context: "contextRead",
  get_prioritized_ideas: "found",
  get_active_path: "found",
  search_ideas: "found",
  search_ideas_semantic: "found",
  list_ideas: "found",
  list_phase_ideas_recursive: "found",
};

export function toolIdeaAccess(toolName: string, args: Record<string, unknown>, result: CallToolResult) {
  const resultKind = RESULT_ACCESS[toolName];
  if (!resultKind || result.isError) return [];
  const target = typeof args.ideaId === "string" ? args.ideaId : undefined;
  const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
  const shown = [...new Set(text.match(UUID_PATTERN) ?? [])].filter((id) => id !== target);
  return [
    ...(target ? [{ ideaIds: [target], kind: "read" as const }] : []),
    ...(shown.length ? [{ ideaIds: shown, kind: resultKind }] : []),
  ];
}

// Fire and forget: activity is a view aid and must never fail a tool call.
export function reportToolActivity(trpcClient: BackendClient, toolName: string, args: Record<string, unknown>, result: CallToolResult) {
  if (typeof args.projectPath !== "string") return;
  for (const access of toolIdeaAccess(toolName, args, result)) {
    void trpcClient.activity.record.mutate({ projectPath: args.projectPath, ...access }).catch(() => {});
  }
}
