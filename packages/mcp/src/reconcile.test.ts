import test from "node:test";
import assert from "node:assert/strict";
import { countAimReferences, findReconciliationCandidates } from "./reconcile.js";

const OPEN = (id: string, text = id) => ({ id, text, status: { state: "open" } });
const DONE = (id: string, text = id) => ({ id, text, status: { state: "done" } });

test("countAimReferences matches an aim by its 8-char id prefix", () => {
  const id = "8ae69400-1743-4569-b77f-0ae6f1109273";
  const counts = countAimReferences(
    ["feat(graph): data model (8ae69400)", "unrelated commit", "fix: more (8ae69400) again"],
    [id, "11111111-2222-3333-4444-555555555555"],
  );
  assert.equal(counts.get(id), 2, "counted both referencing commits");
  assert.equal(counts.get("11111111-2222-3333-4444-555555555555"), undefined, "unreferenced aim absent");
});

test("findReconciliationCandidates surfaces open aims with commit references, ranked", () => {
  const aims = [OPEN("aaaaaaaa-1", "shipped but still open"), OPEN("bbbbbbbb-2", "shipped twice"), OPEN("cccccccc-3", "never committed")];
  const counts = new Map<string, number>([["aaaaaaaa-1", 1], ["bbbbbbbb-2", 3]]);

  const candidates = findReconciliationCandidates(aims, counts);

  assert.deepEqual(candidates.map((c) => c.id), ["bbbbbbbb-2", "aaaaaaaa-1"], "ranked by commit count desc");
  assert.equal(candidates[0]!.commitCount, 3);
  assert.ok(!candidates.some((c) => c.id === "cccccccc-3"), "an open aim with no commits is not a candidate");
});

test("findReconciliationCandidates ignores non-open aims even when committed", () => {
  const aims = [DONE("dddddddd-4"), OPEN("eeeeeeee-5")];
  const counts = new Map<string, number>([["dddddddd-4", 5], ["eeeeeeee-5", 1]]);

  const candidates = findReconciliationCandidates(aims, counts);

  assert.deepEqual(candidates.map((c) => c.id), ["eeeeeeee-5"], "done aim excluded; only the open one drifts");
});

test("findReconciliationCandidates returns empty when nothing drifts", () => {
  assert.deepEqual(findReconciliationCandidates([OPEN("ffffffff-6")], new Map()), []);
});
