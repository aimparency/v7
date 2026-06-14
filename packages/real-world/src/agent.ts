import { anthropic } from "@ai-sdk/anthropic";
import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { stepCountIs, streamText } from "ai";
import { appendReflection, getTopAims, wsClient } from "./aim-client.js";

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

  const top = await getTopAims(projectPath, 3);
  if (top.length === 0) throw new Error("No open aims in the active phase.");
  const target = top[0]!;

  console.log(`\nphase: ${target.phasePath.join(" > ")}`);
  for (const t of top) {
    console.log(
      `  [${t.priority.toFixed(3)}] ${t.aim.text}` +
        ` (value ${t.flowedValue.toFixed(2)}, cost ${t.aggregatedCost.toFixed(2)})`
    );
  }
  console.log(`\nacting on: ${target.aim.text}\n`);

  // LIST mode: verify the aim-graph read half of the loop without any LLM/Composio call.
  if (process.env.REAL_WORLD_LIST === "1") {
    console.log("(list mode — no agent run)");
    return;
  }

  const session = await composio.create(userId);
  const tools = await session.tools();

  const pastLessons = (target.aim.reflections ?? [])
    .slice(-3)
    .map((r) => `- ${r.lesson}`)
    .join("\n");

  let streamError: unknown = null;
  const stream = streamText({
    model,
    system: [
      "You are the real-world arm of aimparency, a goal-graph system.",
      "You receive the single highest-priority aim from the graph's economic model",
      "and make concrete progress on it using the available tools (email, GitHub,",
      "calendar, social, etc. via Composio).",
      act
        ? "You MAY take mutating actions (send, post, create) when they clearly serve the aim."
        : "PLAN MODE: do NOT take any mutating action (no sending, posting, creating)." +
          " You may use read/search/list tools to investigate. Finish with a concrete," +
          " step-by-step plan of the real-world actions you would take, naming the exact" +
          " tools, and note any toolkit that still needs to be connected/authorized.",
      "If a needed toolkit is not connected, say so explicitly and include the auth link if one is returned.",
      "Be economical: the aim was chosen because value/cost is high — don't burn steps on tangents.",
    ].join("\n"),
    prompt: [
      `Aim: ${target.aim.text}`,
      target.aim.description ? `Description: ${target.aim.description}` : "",
      `Phase: ${target.phasePath.join(" > ")}`,
      pastLessons ? `Lessons from past attempts:\n${pastLessons}` : "",
      "Make real-world progress on this aim now.",
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

  // A failed run must not pollute the aim's reflections with empty lessons.
  if (streamError) throw streamError;

  await appendReflection(projectPath, target.aim.id, {
    context: `real-world agent (${act ? "act" : "plan"} mode, ${modelId}) ran on this aim`,
    outcome: finalText.slice(0, 2000),
    effectiveness: act
      ? "see outcome — actions were taken via Composio tools"
      : "plan-mode run: investigation only, no mutations",
    lesson: act
      ? "review outcome and prune what didn't work"
      : "re-run with REAL_WORLD_ACT=1 to execute the plan above",
  });
  console.log(`reflection written to aim ${target.aim.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => wsClient.close());
