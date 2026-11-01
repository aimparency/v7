import { isOngoingState, type Idea } from "shared";
import { PROJECT_PATH_TOOL_PROPERTY } from "../constants.js";
import type { ToolDefinition } from "./types.js";

const MAJOR_IDEA_LIMIT = 12;

// Major ideas: ongoing ideas the graph values for their own sake, plus ongoing
// roots. Highest intrinsic value first; roots break ties.
export function selectMajorIdeas(ideas: Idea[], limit = MAJOR_IDEA_LIMIT): Idea[] {
  return ideas
    .filter((idea) => !idea.archived && isOngoingState(idea.status.state))
    .filter((idea) => idea.intrinsicValue > 0 || idea.supportedIdeas.length === 0)
    .sort((a, b) => b.intrinsicValue - a.intrinsicValue || a.supportedIdeas.length - b.supportedIdeas.length)
    .slice(0, limit);
}

function procedure(focus: string | undefined) {
  return `Run a major hypothesis loop.${focus ? `\nFocus: ${focus}` : ""}

The loop looks outward first, then back at the graph: where is AI going, where is money going, and which of the graph's major ideas could ride that? It produces hypotheses and sub ideas, not implementations.

1. RESEARCH THE WORLD (web search; if you have no browsing, say so and stop after step 2)
   - Latest AI trends: model and agent capabilities released in the last months, new tooling and protocols, what builders are adopting, what is being abandoned.
   - Where money is moving: recent funding rounds, acquisitions, grants and public programs, big-tech capex, revenue that is actually growing (not only valuations). Include non-commercial money (foundations, research and public-interest funds) when it fits the graph.
   - Prefer primary and recent sources; keep the links. Note what surprised you. Never invent sources, numbers, demand or capabilities.

2. GET INSPIRED — loosely
   - Read the major ideas listed below (get_idea_context for the ones that resonate). Hold the research against them loosely: analogies, enabling shifts, new channels, competitors that prove or kill a direction, money that could carry one.
   - Look for combinations of distant major ideas too.

3. WAYS TO REACH THEM
   - For the 2-4 most promising major ideas, sketch the distinct ways to reach them under the researched conditions (build, partner, fund, publish, piggyback on a trend), each with its principal risk.

4. CONSTRUCT SUB IDEAS
   - Per way, the sub ideas that could contribute to the major idea: concrete enough to act on or test, smallest reversible experiment first.
   - Search before adding (search_ideas, search_ideas_semantic): connect or refine an existing idea instead of duplicating it.
   - Create each new sub idea under the idea it serves (create_idea), status open, tags "hypothesis" and "major-hypothesis-loop". Its connection hypothesis says why it may contribute, cites the research link that motivates it, and names the evidence that would refute it.
   - Mark claims OBSERVED (graph/code), RESEARCHED (with link), INFERRED or IMAGINED. Do not set intrinsic values; that stays with the human.

Report compactly: the trends and money flows that mattered (with links), the major ideas you worked on, the ways considered, the sub ideas created or connected (text with short id), and what you deliberately dropped.`;
}

export const hypothesisLoopTools: ToolDefinition[] = [
  {
    name: "major_hypothesis_loop",
    description: "Start a major hypothesis loop: research current AI trends and where money is moving on the internet, get loosely inspired, find the graph's major ideas, consider ways to reach them and create hypothesis sub ideas that could contribute. Returns the procedure and the major ideas.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        focus: { type: "string", description: "Optional theme or idea UUID to steer the loop" },
      },
      required: ["projectPath"],
    },
    handler: async (args, trpcClient) => {
      const ideas = await trpcClient.idea.list.query({ projectPath: args.projectPath as string });
      const major = selectMajorIdeas(ideas);
      const listing = major.length
        ? major.map((idea) => `- ${idea.id} ${idea.text} (intrinsic value ${idea.intrinsicValue}, ${idea.status.state}, ${idea.supportingConnections.length} sub ideas${idea.supportedIdeas.length ? "" : ", root"})`).join("\n")
        : "- none: the graph has no ongoing root or intrinsically valued idea yet; propose major ideas to the human instead of creating sub ideas.";
      const focus = (args.focus as string | undefined)?.trim() || undefined;
      return { content: [{ type: "text", text: `${procedure(focus)}\n\nMajor ideas:\n${listing}` }] };
    },
  },
];
