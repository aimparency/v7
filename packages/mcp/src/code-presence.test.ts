import test from "node:test";
import assert from "node:assert/strict";
import { isCodeShaped, extractCodeTokens, scoreCodePresence } from "./code-presence.js";

test("isCodeShaped accepts identifiers/files and rejects prose", () => {
  for (const t of ["loadVectorStore", "AimEditModal", "build_search_index", "trpc.aim.list", "Column.vue"]) {
    assert.equal(isCodeShaped(t), true, `${t} should be code-shaped`);
  }
  for (const t of ["section", "mirror", "the", "add", "repos", "123", "e.g"]) {
    assert.equal(isCodeShaped(t), false, `${t} should not be code-shaped`);
  }
});

test("extractCodeTokens pulls identifiers + segments and drops generic words", () => {
  const tokens = extractCodeTokens(
    "Add a 'Linked repos' section to AimEditModal.vue mirroring openParentSearch; persist via trpc.aim.linkRepo",
  );
  // identifiers and their meaningful segments are kept
  for (const t of ["AimEditModal.vue", "AimEditModal", "openParentSearch", "trpc.aim.linkRepo", "linkRepo"]) {
    assert.ok(tokens.includes(t), `expected token ${t} in ${JSON.stringify(tokens)}`);
  }
  // prose words are dropped
  for (const t of ["section", "mirroring", "persist", "Linked", "repos"]) {
    assert.ok(!tokens.includes(t), `did not expect prose word ${t}`);
  }
});

test("extractCodeTokens returns nothing for vague prose", () => {
  assert.deepEqual(extractCodeTokens("Make the thing better and faster for users"), []);
});

test("scoreCodePresence: an aim whose tokens are all in code scores 1.0 and is scorable", () => {
  const tokens = ["loadVectorStore", "cosineSimilarity", "findDuplicatePairs"];
  const present = new Set(tokens);
  const s = scoreCodePresence(tokens, present);
  assert.equal(s.scorable, true);
  assert.equal(s.score, 1);
  assert.deepEqual(s.missing, []);
});

test("scoreCodePresence: a partly-present aim scores the matched fraction", () => {
  const tokens = ["AimEditModal", "brandNewUnbuiltThing"];
  const s = scoreCodePresence(tokens, new Set(["AimEditModal"]));
  assert.equal(s.scorable, true);
  assert.equal(s.score, 0.5);
  assert.deepEqual(s.matched, ["AimEditModal"]);
  assert.deepEqual(s.missing, ["brandNewUnbuiltThing"]);
});

test("scoreCodePresence: fewer than 2 tokens is not scorable", () => {
  const s = scoreCodePresence(["onlyOneToken"], new Set(["onlyOneToken"]));
  assert.equal(s.scorable, false);
});
