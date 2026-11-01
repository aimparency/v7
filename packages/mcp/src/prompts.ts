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

// A human-led session: the human gives feedback and ideas, the agent records them in the graph.
function ideaSessionPrompt(args: Record<string, string> | undefined) {
  const target = args?.projectPath?.trim() || DEFAULT_PROJECT_PATH;
  const topic = args?.topic?.trim();
  const text = `Start an Aimparency feedback and ideation session.

Project: ${target}${topic ? `\nTopic: ${topic}` : ""}

The human leads this session: they give feedback and ideas, you record them in the idea graph through the Aimparency MCP tools. Do not implement anything unless the human asks for it. Ask open questions when something is unclear instead of guessing.

For every idea the human brings up:
1. Search before adding: search_ideas (and search_ideas_semantic when the index exists) for the idea and its key terms.
2. Show the human the relevant existing ideas: possible duplicates, overlaps and conflicts, with short ids. Ask whether to connect it, revise an existing idea, consolidate, or add it as a distinct idea. Add without asking only when nothing relevant exists.
3. Place a new idea under the parent it serves, with a connection hypothesis saying why it should contribute.

For feedback on an existing idea, refresh its status against that feedback and the current evidence, with the reason in the status comment:
- open: the intended behavior is still missing;
- partially: some of it exists, but gaps remain (name them);
- implemented: the behavior exists and is verified (tests, build or runtime), with the evidence in the comment;
- review: only when acceptance needs the human's own judgment or check, with one short question for them.
Do not keep a stale review or implemented state just because adjacent or partial functionality exists.

As the session goes on, point out consolidation opportunities (duplicates, ideas that belong under a common parent, parents with too many direct children) and propose them. Never merge ideas, delete ideas or resolve conflicts without the human's decision.

After each change, report in one or two lines what you recorded (idea, short id, status). Then wait for the human: end every turn of this session with [AIMPARENCY_CONFIRM_HUMAN_BLOCK] so a continuation hook yields to them. The session ends when the human says so; then summarize what was recorded and which questions are still open.${topic ? `\n\nStart by showing the human what the graph already holds about the topic, then ask what they want to add or change.` : "\n\nStart by asking the human what they want to give feedback on or add."}`;
  return {
    description: topic ? `Feedback and ideation session about ${topic}` : "Feedback and ideation session",
    messages: [{ role: "user", content: { type: "text", text } }],
  };
}

// Tidy the graph: health checks, duplicates, structure and stale statuses. Merges stay human decisions.
function consolidatePrompt(args: Record<string, string> | undefined) {
  const target = args?.projectPath?.trim() || DEFAULT_PROJECT_PATH;
  const focus = args?.focus?.trim();
  const writeBack = args?.writeBack?.trim().toLowerCase() === "true";
  const text = `Consolidate the Aimparency idea graph.

Project: ${target}
Scope: ${focus ? `the subtree of ${focus}` : "the whole graph"}
Write back: ${writeBack}

Goal: a graph a human can navigate, where every idea appears once, sits under the parent it serves, and has a status that matches the evidence.

1. HEALTH
   - check_consistency; repair broken references with fix_consistency${writeBack ? "" : " (propose it)"}.
   - build_search_index if the semantic tools return nothing, then graph_hygiene with megaParentThreshold = 8.

2. DUPLICATES
   - find_duplicate_ideas, plus your own reading of ideas in the scope. High similarity is often an intended parent-child split or two sides of one feature: check text, description and connections before calling a pair a duplicate.
   - For a real duplicate, propose which idea survives and what the other contributes. Never merge on your own.

3. STRUCTURE
   - Parents with more than about 8 direct children: group the children by common topic under new or existing intermediate ideas. Keep each moved child's connection hypothesis. Do not create a group for one or two children.
   - Catch-all parents: suggest_reparents. Ideas without parent or phase: find the parent they serve.
   - An idea under several parents is fine when it really serves each of them; do not remove such links to tidy up.

4. STATUS
   - reconcile_status: open ideas cited by commits. Check each against the code; verified done work goes to implemented with the evidence (or partially, naming the gaps); review only when the human must judge it.
   - Collapse candidates: finish the parent, or add the child idea it still needs.
   - Cancelled or failed ideas that are not archived: archive them.
   - Settled children whose connection hypothesis has no reflection: write the reflection when the evidence is clear.

Always a human decision, never done by you: merging or deleting ideas, cancelling ideas, setting implemented, and resolving conflicting ideas. ${writeBack
    ? "Apply everything else (grouping, reparenting, archiving, consistency repairs, status updates with evidence, reflections) with the Aimparency tools, and report every mutation."
    : "Do not mutate the graph. Return a precise proposed change set for the human to accept."}

Report compactly, by section: what you found, what you ${writeBack ? "changed" : "propose"} (idea text with short id), and the decisions that are left to the human.`;
  return {
    description: `Consolidate ${focus ? `the subtree of ${focus}` : "the idea graph"}${writeBack ? " (write back)" : ""}`,
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
        name: "consolidate",
        description: "Check and organize the idea graph: consistency, duplicates, crowded parents, stale statuses; merges and deletions stay human decisions",
        arguments: [
          PROJECT_PATH_PROMPT_ARGUMENT,
          { name: "focus", description: "Optional idea UUID whose subtree to consolidate (default: the whole graph)", required: false },
          { name: "writeBack", description: "Set to true to apply the safe reorganization; otherwise only propose changes (default: false)", required: false },
        ],
      },
      {
        name: "idea-session",
        description: "Human-led feedback and ideation session: record the human's ideas and feedback in the graph, searching for duplicates and conflicts first and keeping statuses current",
        arguments: [PROJECT_PATH_PROMPT_ARGUMENT, {
          name: "topic",
          description: "Optional topic or idea UUID the session is about",
          required: false,
        }],
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
    if (name === "idea-session") return ideaSessionPrompt(args);
    if (name === "consolidate") return consolidatePrompt(args);
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
