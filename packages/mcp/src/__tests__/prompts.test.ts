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
  assert.match(text, /Apart from the dream memory, do not mutate the graph/);
});

test("dream remembers since the last dream and wakes with what it remembers", async () => {
  const text = (await setup().getPrompt("dream", { projectPath: "/project/.bowman" })).messages[0].content.text;
  assert.match(text, /one idea tagged "dream-memory".*status\.reviewedAt is the start of this dream's window/);
  assert.match(text, /Always record the memory in the dream-memory idea's status comment.*"Dream: the whole project"/);
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

test("idea-session searches before adding, gates merges and yields every turn to the human", async () => {
  const result = await setup().getPrompt("idea-session", {});
  const text = result.messages[0].content.text;
  assert.equal(result.description, "Feedback and ideation session");
  assert.match(text, /Project: the current repository's \.bowman directory/);
  assert.match(text, /Search before adding/);
  assert.match(text, /review: only when acceptance needs the human/);
  assert.match(text, /Never merge ideas, delete ideas or resolve conflicts without the human's decision/);
  assert.match(text, /end every turn of this session with \[AIMPARENCY_CONFIRM_HUMAN_BLOCK\]/);
});

test("idea-session starts from what the graph holds about a given topic", async () => {
  const result = await setup().getPrompt("idea-session", { projectPath: "/p/.bowman", topic: "list view" });
  const text = result.messages[0].content.text;
  assert.equal(result.description, "Feedback and ideation session about list view");
  assert.match(text, /Project: \/p\/\.bowman\nTopic: list view/);
  assert.match(text, /Start by showing the human what the graph already holds about the topic/);
});

test("consolidate proposes by default and never merges on its own", async () => {
  const result = await setup().getPrompt("consolidate", {});
  const text = result.messages[0].content.text;
  assert.equal(result.description, "Consolidate the idea graph");
  assert.match(text, /Scope: the whole graph/);
  assert.match(text, /megaParentThreshold = 8/);
  assert.match(text, /Never merge on your own/);
  assert.match(text, /merging or deleting ideas, cancelling ideas, setting implemented/);
  assert.match(text, /Do not mutate the graph/);
});

test("consolidate can apply the safe reorganization within a subtree", async () => {
  const result = await setup().getPrompt("consolidate", { projectPath: "/p/.bowman", focus: "22dd4138", writeBack: "true" });
  const text = result.messages[0].content.text;
  assert.equal(result.description, "Consolidate the subtree of 22dd4138 (write back)");
  assert.match(text, /Scope: the subtree of 22dd4138/);
  assert.match(text, /Apply everything else .* and report every mutation/);
});

test("today asks for missing interests and time, mixes waiting-for-a-human ideas in, and stays read-only", async () => {
  const result = await setup().getPrompt("today", {});
  const text = result.messages[0].content.text;
  assert.equal(result.description, "What can I do today?");
  assert.match(text, /First ask, in one short message, what you still need: what they care about or are good at and how much time they have today/);
  assert.match(text, /list_ideas with status human-dependent and unclear/);
  assert.match(text, /Pick at most three/);
  assert.match(text, /Do not change, create or claim any idea/);
});

test("today goes straight to suggestions when interests and time are given", async () => {
  const result = await setup().getPrompt("today", { projectPath: "/hub/.bowman", interests: "gardening", time: "2 hours" });
  const text = result.messages[0].content.text;
  assert.equal(result.description, "What can I do today? (gardening)");
  assert.match(text, /Project: \/hub\/\.bowman\nInterests: gardening\nTime available: 2 hours/);
  assert.doesNotMatch(text, /First ask/);
});
