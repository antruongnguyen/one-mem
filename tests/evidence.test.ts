import { test } from "node:test";
import assert from "node:assert/strict";
import { temporaryMemory } from "./memory-fixtures.js";

test("budget counts UTF-8 bytes", async () => {
  const value = temporaryMemory();
  value.embeddings.embed = async texts => texts.map(() => new Float32Array([1, 0]));
  try {
    const memory = await value.open();
    await memory.upsert(["A", "é", "🙂"].map((text, index) => ({ id: String(index), sourceId: "s", text })));
    const evidence = await memory.search("!", { maxEvidenceBytes: 3 });
    assert.deepEqual(evidence.items.map(item => item.record.text), ["A", "é"]);
    assert.equal(evidence.diagnostics.usedBytes, 3);
    assert.equal(evidence.diagnostics.budgetOmitted, 1);
    const complete = await memory.search("!");
    assert.equal(complete.diagnostics.usedBytes, 7);
    assert.equal(complete.diagnostics.budgetOmitted, 0);
    const zero = await memory.search("!", { maxEvidenceBytes: 0 });
    assert.deepEqual(zero.items, []);
    assert.equal(zero.diagnostics.usedBytes, 0);
    assert.equal(zero.diagnostics.budgetOmitted, 3);
  } finally { await value.cleanup(); }
});

test("oversized record is skipped whole", async () => {
  const value = temporaryMemory();
  value.embeddings.embed = async texts => texts.map(() => new Float32Array([1, 0]));
  try {
    const memory = await value.open();
    await memory.upsert([{ id: "a", sourceId: "s", text: "🙂🙂" },
      { id: "b", sourceId: "s", text: "é" }, { id: "c", sourceId: "s", text: "A" }]);
    const evidence = await memory.search("!", { limit: 1, maxEvidenceBytes: 2 });
    assert.deepEqual(evidence.items.map(item => item.record.text), ["é"]);
    assert.equal(evidence.diagnostics.usedBytes, 2);
    assert.equal(evidence.diagnostics.budgetOmitted, 1);
    assert.equal((await memory.get("a"))?.text, "🙂🙂");
  } finally { await value.cleanup(); }
});
