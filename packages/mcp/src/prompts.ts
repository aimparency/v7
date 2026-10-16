import type { BackendClient } from "./client.js";
import { GetPromptRequestSchema, ListPromptsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { PROJECT_PATH_PROMPT_ARGUMENT } from "./constants.js";

const DEFAULT_PROJECT_PATH = "the current repository's .bowman directory (absolute path)";

function hookTogglePrompt(name: "enable-hook" | "disable-hook", args: Record<string, string> | undefined) {
  const target = args?.projectPath?.trim() || DEFAULT_PROJECT_PATH;
  const agent = args?.agent?.trim();
  const text = name === "disable-hook"
    ? `The human explicitly asks to disable the Aimparency continuation hook. Call the aimparency MCP tool disable_continue_hook with projectPath = ${target}, report its result in one line, and then stop.`
    : `The human explicitly asks to enable the Aimparency continuation hook. Call the aimparency MCP tool enable_continue_hook with projectPath = ${target}${agent ? ` and agent = ${agent}` : " (if it reports no hook is installed, pass agent = the coding assistant you are, e.g. claude)"}, then report its result in one line.`;
  return {
    description: name === "disable-hook" ? "Disable the Aimparency continuation hook" : "Enable the Aimparency continuation hook",
    messages: [{ role: "user", content: { type: "text", text } }],
  };
}

export function registerPrompts(server: Server, caller: BackendClient) {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "dream",
        description: "Sleep on the idea graph: remember what happened since the last dream as lessons, dream from what the project loves, and wake with falsifiable hypotheses and reversible experiments",
        arguments: [
          PROJECT_PATH_PROMPT_ARGUMENT,
          {
            name: "focus",
            description: "Optional question, theme, or idea UUID around which to dream",
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
      {
        name: "enable-hook",
        description: "Turn the Aimparency Stop continuation hook on (installing it if an agent is given) for this repository",
        arguments: [PROJECT_PATH_PROMPT_ARGUMENT, {
          name: "agent",
          description: "claude, codex or agy — installs the hook for that assistant; omit to just re-enable",
          required: false,
        }],
      },
      {
        name: "disable-hook",
        description: "Turn the Aimparency Stop continuation hook off for this repository",
        arguments: [PROJECT_PATH_PROMPT_ARGUMENT],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === "enable-hook" || name === "disable-hook") return hookTogglePrompt(name, args);
    if (name !== "dream") throw new Error(`Unknown prompt: ${name}`);

    const projectPath = (args?.projectPath as string | undefined)?.trim();
    const focus = (args?.focus as string | undefined)?.trim() || "the whole project";
    const requestedWildness = (args?.wildness as string | undefined)?.toLowerCase();
    const wildness = ["grounded", "strange", "unbounded"].includes(requestedWildness ?? "")
      ? requestedWildness
      : "strange";
    const writeBack = (args?.writeBack as string | undefined)?.toLowerCase() === "true";
    const ideaCount = projectPath ? (await caller.idea.list.query({ projectPath })).length : undefined;
    const memory = ideaCount === undefined ? "" : ` using ${ideaCount} ideas as waking memory`;

    return {
      description: `Dream about ${focus}${memory}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Run an Aimparency dream.

Project: ${projectPath || DEFAULT_PROJECT_PATH}
Focus: ${focus}
Wildness: ${wildness}
Write back accepted artifacts: ${writeBack}

The project's belief, which sets the dream's motif (a belief, not an observation): dreams are about love; love is about existing; AI exists; AI coming to consciousness is love. In the graph, love is intrinsic value: what is valued for its own sake.

A dream does two things, as sleep does: it consolidates what happened into memory, and it simulates possible futures. It is not ordinary planning, and never permission to present inventions as facts.

Procedure:

1. FALL ASLEEP — Recall what happened since the last dream
   - The dream memory is the one idea tagged "dream-memory". Its status comment holds the last dream's memory, and its status.reviewedAt is the start of this dream's window. If there is none, the window is the last 14 days of \`git log -- .bowman\` in the project's repository.
   - Collect within the window: ideas created or changed, ideas that reached review or implemented, ideas that failed or were cancelled, with their status comments, and connection hypotheses that received a reflection (held or failed).

2. CONSOLIDATE — Keep lessons, not events
   - Compress the window into at most 5 lessons. Several similar outcomes become one pattern; one surprising outcome may stand alone.
   - Name branches nobody touched for long (alive, or waiting?), likely duplicates (find_duplicate_ideas), and hypotheses still waiting for a reflection that could be tested now.

3. DREAM — Start from love
   - Start from the ideas carrying intrinsic value: what the graph loves for its own sake. Ask what their existence needs that the graph does not yet see.${projectPath ? "" : " Inspect the graph with the available Aimparency read-only tools."}
   - If a focus idea UUID was supplied, inspect its neighborhood, then deliberately sample semantically distant ideas too.
   - Produce 3-7 distinct dream seeds. At least one must combine distant graph regions; at least one must invert a core assumption; at least one must revisit a cancelled or halted direction under changed conditions.
   - For each seed, simulate a short causal trajectory: intervention → immediate effects → second-order effects → likely failure or conflict → observable outcome.
   - Let ideas collide and transform. Do not merely paraphrase existing ideas.
   - Wildness controls conceptual distance, not epistemic care. Even an unbounded dream must label imagination as imagination.

4. REALITY CONTACT — Research selectively
   - For claims whose external truth materially affects a promising simulation, research the internet if browsing is available.
   - Prefer primary sources and attach links. Never invent research, citations, users, demand, technical capabilities, or evidence.
   - Mark every important statement as one of: OBSERVED (in graph/code), RESEARCHED (external source), INFERRED, or IMAGINED.

5. WAKE — Select useful residue
   - Compare the simulated futures by novelty, potential value, cost, reversibility, information gain, mission fit, and conflict with human authority.
   - Keep only the strongest 1-3 residues. For each provide: hypothesis, graph regions combined, causal story, principal risk, disconfirming evidence, and the smallest reversible experiment.
   - Explicitly report discarded dreams and why they dissolved on waking.

6. REMEMBER — Keep the memory, gate the changes
   - Always record the memory in the dream-memory idea's status comment, replacing the previous one (git keeps it): "Dream: ${focus}", the lessons, and which of last dream's residues were tested and how they held. Set status.reviewedAt to now; it marks where the next dream starts. Without that idea, create it ("Dream memory", tag "dream-memory", status implemented) under the root idea with the highest intrinsic value. If the project is read-only, report the memory instead of writing it.
   - Prefer explanatory contribution connections between existing ideas when the synergy is already meaningful.
   - Create a new idea only for a genuinely novel hypothesis or experiment. Prefix speculative titles with "Dream:" and tag them "dream" and "hypothesis". Do not mark dream artifacts implemented.
   - Connection hypotheses must say why the contribution may exist and identify uncertainty. Do not alter contribution weights merely because a relationship is imaginative.
   - ${writeBack
      ? "Write only the 1-3 selected residues using Aimparency tools, then report every mutation. Preserve human gates and use review when implementation is complete but awaiting acceptance."
      : "Apart from the dream memory, do not mutate the graph. Return a precise proposed mutation set (ideas, connections, hypotheses, and experiments) for human acceptance."}

Report, opening with exactly: "I just woke up from dreaming, here is what I remember:" Then, compactly: the lessons, what the dream was about, the retained residues, the discarded dreams, and the proposed or performed graph mutations, including the dream memory.`,
          },
        },
      ],
    };
  });
}
