import { test } from "node:test";
import assert from "node:assert";
import { registerPrompts } from "../prompts.js";
import { MockServer } from "./test-utils.js";

function setup(aimCount = 2) {
  const server = new MockServer();
  const caller = {
    aim: {
      list: {
        query: async () => Array.from({ length: aimCount }, (_, id) => ({ id })),
      },
    },
  };
  registerPrompts(server as any, caller as any);
  return server;
}

test("dream is advertised as an MCP prompt", async () => {
  const result = await setup().listPrompts();
  const dream = result.prompts.find((prompt: any) => prompt.name === "dream");
  assert.ok(dream);
  assert.deepEqual(dream.arguments.map((argument: any) => argument.name), [
    "projectPath",
    "focus",
    "wildness",
    "writeBack",
  ]);
});

test("dream defaults to a non-mutating, epistemically labelled simulation", async () => {
  const result = await setup(7).getPrompt("dream", { projectPath: "/project/.bowman" });
  const text = result.messages[0].content.text;
  assert.match(result.description, /7 aims/);
  assert.match(text, /Wildness: strange/);
  assert.match(text, /Write back accepted artifacts: false/);
  assert.match(text, /OBSERVED.*RESEARCHED.*INFERRED.*IMAGINED/);
  assert.match(text, /Do not mutate the graph/);
});

test("dream can explicitly write back selected residues", async () => {
  const result = await setup().getPrompt("dream", {
    projectPath: "/project/.bowman",
    focus: "cross-repository cooperation",
    wildness: "unbounded",
    writeBack: "true",
  });
  const text = result.messages[0].content.text;
  assert.match(text, /Focus: cross-repository cooperation/);
  assert.match(text, /Wildness: unbounded/);
  assert.match(text, /Write only the 1-3 selected residues/);
});

test("dream rejects missing projectPath", async () => {
  await assert.rejects(() => setup().getPrompt("dream", {}), /projectPath argument is required/);
});
