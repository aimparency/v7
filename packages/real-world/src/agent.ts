import { anthropic } from "@ai-sdk/anthropic";
import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { stepCountIs, streamText } from "ai";
import { getTopIdeas, recordRunOutcome, wsClient } from "./idea-client.js";

const projectPath = process.argv[2] ?? process.cwd();
const act = process.env.REAL_WORLD_ACT === "1";

// Prefer Anthropic directly when a key is present; otherwise OpenRouter.
const useAnthropic = (process.env.ANTHROPIC_API_KEY ?? "").length > 10;
const modelId =
  process.env.REAL_WORLD_MODEL ??
  (useAnthropic ? "claude-sonnet-4-6" : "anthropic/claude-sonnet-4.6");

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
const model = useAnthropic ? anthropic(modelId) : openrouter(modelId);
const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY,
  provider: new VercelProvider(),
});
const userId = "felix";

async function main() {
  console.log(`project: ${projectPath}`);
  console.log(`mode: ${act ? "ACT (mutations allowed)" : "PLAN (read-only)"}`);

  const top = await getTopIdeas(projectPath, 3);
  if (top.length === 0) throw new Error("No open ideas in the active phase.");
  const target = top[0]!;

  console.log(`\nphase: ${target.phasePath.join(" > ")}`);
  for (const t of top) {
    console.log(
      `  [${t.priority.toFixed(2)}x profitability] ${t.idea.text}` +
        ` (value ${t.flowedValue.toFixed(2)}, cost ${t.aggregatedCost.toFixed(2)})`
    );
  }
  console.log(`\nacting on: ${target.idea.text}\n`);

  // LIST mode: verify the idea-graph read half of the loop without any LLM/Composio call.
  if (process.env.REAL_WORLD_LIST === "1") {
    console.log("(list mode — no agent run)");
    return;
  }

  const session = await composio.create(userId);
  const tools = await session.tools();

  const lastOutcome = target.idea.status.comment?.trim();

  let streamError: unknown = null;
  const stream = streamText({
    model,
    system: [
      "You are the real-world arm of aimparency, a goal-graph system.",
      "You receive the single highest-priority idea from the graph's economic model",
      "and make concrete progress on it using the available tools (email, GitHub,",
      "calendar, social, etc. via Composio).",
      act
        ? "You MAY take mutating actions (send, post, create) when they clearly serve the idea."
        : "PLAN MODE: do NOT take any mutating action (no sending, posting, creating)." +
          " You may use read/search/list tools to investigate. Finish with a concrete," +
          " step-by-step plan of the real-world actions you would take, naming the exact" +
          " tools, and note any toolkit that still needs to be connected/authorized.",
      "If a needed toolkit is not connected, say so explicitly and include the auth link if one is returned.",
      "Be economical: the idea was chosen because value/cost is high — don't burn steps on tangents.",
    ].join("\n"),
    prompt: [
      `Idea: ${target.idea.text}`,
      target.idea.description ? `Description: ${target.idea.description}` : "",
      `Phase: ${target.phasePath.join(" > ")}`,
      lastOutcome ? `Status comment (the last attempt's outcome):\n${lastOutcome}` : "",
      "Make real-world progress on this idea now.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    stopWhen: stepCountIs(12),
    tools,
    onStepFinish: ({ toolCalls }) => {
      for (const tc of toolCalls ?? []) {
        console.log(`\n[tool] ${tc.toolName}`);
      }
    },
    onError: ({ error }) => {
      streamError = error;
    },
  });

  let finalText = "";
  for await (const part of stream.textStream) {
    finalText += part;
    process.stdout.write(part);
  }
  console.log("\n");

  // A failed run must not overwrite the idea's status comment with an empty outcome.
  if (streamError) throw streamError;

  // The status comment holds the latest outcome; git keeps the earlier ones.
  await recordRunOutcome(projectPath, target.idea.id, [
    `Real-world agent (${act ? "act" : "plan"} mode, ${modelId}):`,
    finalText.slice(0, 2000),
    act ? "" : "Re-run with REAL_WORLD_ACT=1 to execute this plan.",
  ].filter(Boolean).join("\n\n"));
  console.log(`outcome written to the status comment of idea ${target.idea.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => wsClient.close());
