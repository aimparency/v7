import { GetPromptRequestSchema, ListPromptsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { PROJECT_PATH_PROMPT_ARGUMENT } from "./constants.js";

export function registerPrompts(server: Server, caller: any) {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "dream",
        description: "Simulate possible futures from the aim graph, discover non-obvious synergies and tensions, and wake with falsifiable hypotheses and reversible experiments",
        arguments: [
          PROJECT_PATH_PROMPT_ARGUMENT,
          {
            name: "focus",
            description: "Optional question, theme, or aim UUID around which to dream",
            required: false,
          },
          {
            name: "wildness",
            description: "How far to move beyond the graph's current assumptions: grounded, strange, or unbounded (default: strange)",
            required: false,
          },
          {
            name: "writeBack",
            description: "Set to true to write accepted dream artifacts to the graph; otherwise only propose changes (default: false)",
            required: false,
          },
        ],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name !== "dream") throw new Error(`Unknown prompt: ${name}`);

    const projectPath = args?.projectPath as string | undefined;
    if (!projectPath) throw new Error("projectPath argument is required");

    const focus = (args?.focus as string | undefined)?.trim() || "the whole project";
    const requestedWildness = (args?.wildness as string | undefined)?.toLowerCase();
    const wildness = ["grounded", "strange", "unbounded"].includes(requestedWildness ?? "")
      ? requestedWildness
      : "strange";
    const writeBack = (args?.writeBack as string | undefined)?.toLowerCase() === "true";
    const aims = await caller.aim.list.query({ projectPath });

    return {
      description: `Dream about ${focus} using ${aims.length} aims as waking memory`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Run an Aimparency dream procedure.

Project: ${projectPath}
Waking-memory size: ${aims.length} aims
Focus: ${focus}
Wildness: ${wildness}
Write back accepted artifacts: ${writeBack}

A dream is a counterfactual simulation over the idea graph. It is not graph hygiene, ordinary planning, or permission to present inventions as facts. Hygiene may supply useful signals, but the purpose is to discover possible futures, hidden synergies, tensions, and cheap tests.

Procedure:

1. SLEEP — Acquire waking memory
   - Inspect the active graph, current phases, priorities, statuses, descriptions, connection explanations, and reflections using the available Aimparency resources and read-only tools.
   - If a focus aim UUID was supplied, inspect its neighborhood, then deliberately sample semantically distant aims too.
   - Note unresolved tensions, bottlenecks, abandoned directions, surprising proximity, and valuable capabilities with no current application.

2. DREAM — Generate and simulate
   - Produce 3-7 distinct dream seeds. At least one must combine distant graph regions; at least one must invert a core assumption; at least one must revisit a cancelled or halted direction under changed conditions.
   - For each seed, simulate a short causal trajectory: intervention → immediate effects → second-order effects → likely failure or conflict → observable outcome.
   - Let ideas collide and transform. Do not merely paraphrase existing aims.
   - Wildness controls conceptual distance, not epistemic care. Even an unbounded dream must label imagination as imagination.

3. REALITY CONTACT — Research selectively
   - For claims whose external truth materially affects a promising simulation, research the internet if browsing is available.
   - Prefer primary sources and attach links. Never invent research, citations, users, demand, technical capabilities, or evidence.
   - Mark every important statement as one of: OBSERVED (in graph/code), RESEARCHED (external source), INFERRED, or IMAGINED.

4. WAKE — Select useful residue
   - Compare the simulated futures by novelty, potential value, cost, reversibility, information gain, mission fit, and conflict with human authority.
   - Keep only the strongest 1-3 residues. For each provide: hypothesis, graph regions combined, causal story, principal risk, disconfirming evidence, and the smallest reversible experiment.
   - Explicitly report discarded dreams and why they dissolved on waking.

5. REMEMBER — Propose or write graph changes
   - Prefer explanatory contribution connections between existing aims when the synergy is already meaningful.
   - Create a new aim only for a genuinely novel hypothesis or experiment. Prefix speculative titles with "Dream:" and tag them "dream" and "hypothesis". Do not mark dream artifacts done.
   - Connection explanations must say why the contribution may exist and identify uncertainty. Do not alter contribution weights merely because a relationship is imaginative.
   - ${writeBack
      ? "Write only the 1-3 selected residues using Aimparency tools, then report every mutation. Preserve human gates and use review when implementation is complete but awaiting acceptance."
      : "Do not mutate the graph. Return a precise proposed mutation set (aims, connections, explanations, and experiments) for human acceptance."}

Finish with a compact DREAM REPORT containing: waking tensions, dream simulations, reality checks, retained residues, discarded dreams, and proposed/performed graph mutations.`,
          },
        },
      ],
    };
  });
}
