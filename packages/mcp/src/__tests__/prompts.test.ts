import { test } from "node:test";
import assert from "node:assert";
import { registerPrompts } from "../prompts.js";
import { MockServer } from "./test-utils.js";

function setup(ideaCount = 2) {
  const server = new MockServer();
  const caller = {
    idea: {
      list: {
        query: async () => Array.from({ length: ideaCount }, (_, id) => ({ id })),
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

test("dream defaults to an epistemically labelled dream that keeps only its memory", async () => {
  const result = await setup(7).getPrompt("dream", { projectPath: "/project/.bowman" });
  const text = result.messages[0].content.text;
  assert.match(result.description, /7 ideas/);
  assert.match(text, /Wildness: strange/);
  assert.match(text, /Write back accepted artifacts: false/);
  assert.match(text, /OBSERVED.*RESEARCHED.*INFERRED.*IMAGINED/);
  assert.match(text, /Apart from the memory reflection, do not mutate the graph/);
});

test("dream remembers since the last dream and wakes with what it remembers", async () => {
  const text = (await setup().getPrompt("dream", { projectPath: "/project/.bowman" })).messages[0].content.text;
  assert.match(text, /newest reflection, on any idea, whose context starts with "Dream:"/);
  assert.match(text, /Always record the memory: addReflection .* context "Dream: the whole project"/);
  assert.match(text, /love is intrinsic value/);
  assert.match(text, /opening with exactly: "I just woke up from dreaming, here is what I remember:"/);
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

test("dream works without a path, defaulting to the current repository", async () => {
  const result = await setup().getPrompt("dream", {});
  assert.equal(result.description, "Dream about the whole project");
  assert.match(result.messages[0].content.text, /Project: the current repository's \.bowman directory/);
});

test("disable-hook works without a path and instructs a single explicit tool call", async () => {
  const result = await setup().getPrompt("disable-hook", {});
  const text = result.messages[0].content.text;
  assert.match(text, /explicitly asks/);
  assert.match(text, /disable_continue_hook/);
  assert.match(text, /current repository/);
});

test("enable-hook passes through projectPath and agent", async () => {
  const result = await setup().getPrompt("enable-hook", { projectPath: "/p/.bowman", agent: "claude" });
  const text = result.messages[0].content.text;
  assert.match(text, /enable_continue_hook with projectPath = \/p\/\.bowman and agent = claude/);
});
