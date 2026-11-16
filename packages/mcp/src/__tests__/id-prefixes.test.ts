import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { expandIdPrefixes } from "../tools/id-prefixes.js";

const IDS = [
  "1f6f2c46-2913-40e5-880f-77e02a59854e",
  "1f6f9999-0000-4000-8000-000000000000",
  "d4203221-939e-44e6-bf3f-b3933c790e6b",
];
const client = {
  graph: {
    idsBeginningWith: {
      query: async ({ prefixes }: { prefixes: string[] }) =>
        Object.fromEntries(prefixes.map((prefix) => [prefix, IDS.filter((id) => id.startsWith(prefix.toLowerCase()))])),
    },
  },
} as never;

describe("ids named by their beginning", () => {
  it("become the one id they begin with, wherever arguments name ideas or phases", async () => {
    const args = {
      graph: "g",
      ideaId: "1f6f2c46",
      text: "d4203221 stays text",
      addSupportedIdeas: ["D4203221", { ideaId: "d420", siblingShares: { "1f6f2c": 20 } }],
      removeSupportingConnections: [IDS[1]],
    };
    assert.deepEqual(await expandIdPrefixes(args, client), {
      graph: "g",
      ideaId: IDS[0],
      text: "d4203221 stays text",
      addSupportedIdeas: [IDS[2], { ideaId: IDS[2], siblingShares: { [IDS[0]!]: 20 } }],
      removeSupportingConnections: [IDS[1]],
    });
  });

  it("fail when several ids or none begin that way", async () => {
    await assert.rejects(expandIdPrefixes({ graph: "g", ideaId: "1f6f" }, client), /several ids: 1f6f2c46.*1f6f9999.*Give more/);
    await assert.rejects(expandIdPrefixes({ graph: "g", ideaId: "abcdef12" }, client), /No idea or phase id begins with "abcdef12"/);
  });

  it("leave full ids alone without asking", async () => {
    const args = { graph: "g", ideaId: IDS[0] };
    assert.equal(await expandIdPrefixes(args, { graph: { idsBeginningWith: { query: async () => { throw new Error("asked") } } } } as never), args);
  });
});
