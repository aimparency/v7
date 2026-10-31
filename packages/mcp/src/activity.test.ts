import test from "node:test";
import assert from "node:assert/strict";
import { toolIdeaAccess } from "./activity.js";

const TARGET = "11111111-2222-3333-4444-555555555555";
const PARENT = "aaaaaaaa-2222-3333-4444-555555555555";
const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

test("the asked-about idea is an explicit read, the ideas around it context reads", () => {
  const access = toolIdeaAccess("get_idea_context", { ideaId: TARGET }, text(`Idea ${TARGET}\nParent ${PARENT} and ${PARENT}`));
  assert.deepEqual(access, [
    { ideaIds: [TARGET], kind: "read" },
    { ideaIds: [PARENT], kind: "contextRead" },
  ]);
});

test("search and list results count as found; writes and failures report nothing", () => {
  assert.deepEqual(toolIdeaAccess("search_ideas", { query: "x" }, text(`${TARGET}`)), [{ ideaIds: [TARGET], kind: "found" }]);
  assert.deepEqual(toolIdeaAccess("update_idea", { ideaId: TARGET }, text("Updated")), []);
  assert.deepEqual(toolIdeaAccess("get_idea", { ideaId: TARGET }, { ...text("boom"), isError: true }), []);
});
