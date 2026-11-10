import { test } from "node:test";
import assert from "node:assert/strict";
import { compileLexicalQuery, fuseRanks } from "../dist/retrieval.js";

test("RRF uses ranks not raw scores", () => {
  const fused = fuseRanks(["B", "C"], ["A", "B"]);
  assert.deepEqual(fused.map(item => item.id), ["B", "A", "C"]);
  assert.deepEqual(fused.map(item => item.ranks), [
    { dense: 1, lexical: 2 }, { lexical: 1 }, { dense: 2 },
  ]);
  const scoreOf = (id: string) => fused.find(item => item.id === id)!.score;
  assert.ok(Math.abs(scoreOf("B") - (1 / 61 + 1 / 62)) < 1e-12);
  assert.ok(Math.abs(scoreOf("A") - 1 / 61) < 1e-12);
  assert.ok(Math.abs(scoreOf("C") - 1 / 62) < 1e-12);
});

test("stable ID breaks ties using UTF-8 binary ordering", () => {
  assert.deepEqual(fuseRanks(["\u{10000}"], ["\ue000"]).map(item => item.id), ["\ue000", "\u{10000}"]);
  assert.deepEqual(fuseRanks(["B"], ["A"]).map(item => item.id), ["A", "B"]);
});

test("literal FTS input cannot inject syntax", () => {
  assert.deepEqual(compileLexicalQuery('"ZX-81" OR (repair) NEAR(one two) -:*'), {
    match: '"zx" OR "81" OR "or" OR "repair" OR "near" OR "one" OR "two"',
    termsUsed: 7, truncated: false,
  });
  assert.deepEqual(compileLexicalQuery('"():* + -- 🙂'), { match: null, termsUsed: 0, truncated: false });
});

test("lexical terms are distinct Unicode tokens and bounded to 32", () => {
  assert.deepEqual(compileLexicalQuery("Café CAFÉ mã_lỗi 2048 mã_lỗi"), {
    match: '"café" OR "mã_lỗi" OR "2048"', termsUsed: 3, truncated: false,
  });
  const terms = Array.from({ length: 32 }, (_, index) => `token${index}`);
  const bounded = compileLexicalQuery(terms.join(" "));
  assert.equal(bounded.termsUsed, 32);
  assert.equal(bounded.truncated, false);
  assert.deepEqual(compileLexicalQuery([...terms, "TOKEN0"].join(" ")), bounded);
  assert.deepEqual(compileLexicalQuery([...terms, "extra"].join(" ")), { ...bounded, truncated: true });
});
