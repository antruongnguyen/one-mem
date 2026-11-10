import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openStorage } from "../dist/storage.js";
import { compileLexicalQuery } from "../dist/retrieval.js";
import { temporaryMemory } from "./memory-fixtures.js";
import type { Evidence, MemoryInput } from "../dist/index.js";

function fixture() {
  const value = temporaryMemory();
  value.embeddings.embed = async function(texts, options) {
    this.inputs.push(...texts);
    return texts.map(text => new Float32Array(options.purpose === "query" ? [1, 0]
      : text.startsWith("ZX-81 repair unrelated") ? [0.8, 0.6]
        : text === "blue ocean" ? [0, 1] : text === "green leaf" ? [-1, 0] : [1, 0]));
  };
  return value;
}

test("orders known cosine neighbors", async () => {
  const value = fixture();
  try {
    const memory = await value.open();
    await memory.upsert([
      { id: "c", sourceId: "s", text: "green leaf" },
      { id: "b", sourceId: "s", text: "blue ocean" },
      { id: "a", sourceId: "s", text: "red apple" },
    ]);
    const evidence = await memory.search("🙂");
    assert.deepEqual(evidence.items.map(item => item.record.id), ["a", "b", "c"]);
    assert.deepEqual(evidence.items.map(item => item.ranks), [{ dense: 1 }, { dense: 2 }, { dense: 3 }]);
    assert.deepEqual(evidence.items.map(item => item.score), [1 / 61, 1 / 62, 1 / 63]);
    assert.equal(evidence.diagnostics.lexicalCandidates, 0);
    assert.equal(evidence.diagnostics.lexicalTermsUsed, 0);
    assert.equal(evidence.namespace, "fixture");
    assert.equal(evidence.query, "🙂");
    assert.deepEqual(evidence.embeddingSpace, value.embeddings.space);
    assert.ok(evidence.items.every(item => item.role === "match"));
  } finally { await value.cleanup(); }
});

for (const scope of ["source", "session"] as const) {
  test(`scope is applied before top k for ${scope}`, async () => {
    const value = fixture();
    try {
      const memory = await value.open();
      const target: MemoryInput = { id: "a", sourceId: scope === "source" ? "A" : "s",
        text: "ZX-81 repair " + Array.from({ length: 200 }, () => "unrelated").join(" "),
        ...(scope === "session" ? { sessionId: "A", sequence: 0 } : {}) };
      const distractors = Array.from({ length: 51 }, (_, index): MemoryInput => ({
        id: `b${String(index).padStart(3, "0")}`, sourceId: scope === "source" ? "B" : "s",
        text: "ZX-81 repair", ...(scope === "session" ? { sessionId: "B", sequence: index } : {}),
      }));
      await memory.upsert([target, ...distractors]);
      const db = openStorage(value.path);
      try {
        const vector = Buffer.alloc(8); vector.writeFloatLE(1, 0);
        const dense = db.prepare<unknown[], { id: string }>(
          "SELECT id FROM records ORDER BY vec_distance_cosine(embedding, ?) ASC, id COLLATE BINARY ASC LIMIT 50",
        ).all(vector).map(row => row.id);
        const lexical = db.prepare<unknown[], { id: string }>(
          "SELECT r.id FROM records_fts JOIN records r ON r.row_id = records_fts.rowid WHERE records_fts MATCH ? ORDER BY bm25(records_fts) ASC, r.id COLLATE BINARY ASC LIMIT 50",
        ).all(compileLexicalQuery("ZX-81 repair").match).map(row => row.id);
        assert.equal(dense.length, 50);
        assert.equal(lexical.length, 50);
        assert.ok(dense.every(id => id !== "a"));
        assert.ok(lexical.every(id => id !== "a"));
      } finally { db.close(); }
      const evidence = await memory.search("ZX-81 repair", { limit: 1, sourceId: target.sourceId,
        ...(scope === "session" ? { sessionId: "A" } : {}) });
      assert.deepEqual(evidence.items.map(item => item.record.id), ["a"]);
      assert.deepEqual(evidence.items[0].ranks, { dense: 1, lexical: 1 });
      assert.equal(evidence.diagnostics.denseCandidates, 1);
      assert.equal(evidence.diagnostics.lexicalCandidates, 1);
      const unscoped = await memory.search("ZX-81 repair", { limit: 1 });
      assert.equal(unscoped.diagnostics.denseCandidates, 50);
      assert.equal(unscoped.diagnostics.lexicalCandidates, 50);
      assert.notEqual(unscoped.items[0].record.id, "a");
    } finally { await value.cleanup(); }
  });
}

test("controlled FTS queries preserve literal words and skip punctuation", async () => {
  const value = fixture();
  try {
    const memory = await value.open();
    await memory.upsert([
      { id: "a", sourceId: "s", text: "red apple" },
      { id: "b", sourceId: "s", text: "blue ocean" },
    ]);
    const evidence = await memory.search('"apple" OR (NEAR) -:*');
    assert.deepEqual(evidence.items.filter(item => item.ranks.lexical !== undefined).map(item => item.record.id), ["a"]);
    assert.equal(evidence.diagnostics.lexicalTermsUsed, 3);
    const punctuation = await memory.search('():* - " 🙂');
    assert.equal(punctuation.diagnostics.lexicalCandidates, 0);
    assert.equal(punctuation.items.length, 2);
  } finally { await value.cleanup(); }
});

for (const [name, query, text] of [
  ["entity-poor language", "quietly", "the room became quietly warm"],
  ["numeric fact", "2048", "the buffer holds 2048 bytes"],
  ["code identifier", "parse_memory", "parse_memory checks each supplied record"],
  ["Vietnamese accented text", "mùa", "Tôi thích mùa hè ở Đà Nẵng"],
] as const) {
  test(`lexical retrieval matches ${name}`, async () => {
    const value = fixture();
    try {
      const memory = await value.open();
      await memory.upsert([{ id: "a", sourceId: "s", text }, { id: "b", sourceId: "s", text: "irrelevant" }]);
      const evidence = await memory.search(query);
      assert.deepEqual(evidence.items.filter(item => item.ranks.lexical !== undefined).map(item => item.record.id), ["a"]);
      assert.equal(evidence.items[0].record.text, text);
      assert.equal(evidence.items[0].ranks.lexical, 1);
    } finally { await value.cleanup(); }
  });
}

test("empty corpus skips provider", async () => {
  const value = fixture();
  try {
    const memory = await value.open();
    const evidence = await memory.search("apple");
    assert.deepEqual(evidence.items, []);
    assert.deepEqual(value.embeddings.inputs, []);
    assert.deepEqual(evidence.diagnostics, { denseCandidates: 0, lexicalCandidates: 0,
      lexicalTermsUsed: 1, lexicalTermsTruncated: false, usedBytes: 0, budgetOmitted: 0 });
  } finally { await value.cleanup(); }
});

test("updated deleted text cannot be searched after reopen", async () => {
  const value = fixture();
  try {
    let memory = await value.open();
    await memory.upsert([{ id: "a", sourceId: "s", text: "ZX-81 repair" }]);
    assert.equal((await memory.search("ZX-81")).items[0].ranks.lexical, 1);
    await memory.upsert([{ id: "a", sourceId: "s", text: "garden planning" }]);
    await memory.close();
    memory = await value.open();
    const updated = await memory.search("ZX-81");
    assert.equal(updated.diagnostics.lexicalCandidates, 0);
    assert.equal(updated.items[0].record.text, "garden planning");
    assert.deepEqual(updated.items[0].ranks, { dense: 1 });
    await memory.remove(["a"]);
    await memory.close();
    memory = await value.open();
    const deleted = await memory.search("garden planning");
    assert.deepEqual(deleted.items, []);
    assert.equal(deleted.diagnostics.denseCandidates, 0);
    assert.equal(deleted.diagnostics.lexicalCandidates, 0);
  } finally { await value.cleanup(); }
});

test("duplicate text retains distinct provenance", async () => {
  const value = fixture();
  try {
    const memory = await value.open();
    await memory.upsert([{ id: "a", sourceId: "A", text: "red apple" }, { id: "b", sourceId: "B", text: "red apple" }]);
    const evidence = await memory.search("apple");
    assert.deepEqual(evidence.items.map(item => [item.record.id, item.record.sourceId, item.record.text]),
      [["a", "A", "red apple"], ["b", "B", "red apple"]]);
    assert.notEqual(evidence.items[0].record.revision, evidence.items[1].record.revision);
    assert.equal(evidence.diagnostics.usedBytes, 18);
  } finally { await value.cleanup(); }
});

test("branch and fused ties follow binary ID ordering", async () => {
  const value = fixture();
  try {
    const memory = await value.open();
    await memory.upsert(["\u{10000}", "\ue000", "b", "A"].map(id => ({ id, sourceId: "s", text: "red apple" })));
    const evidence = await memory.search("apple");
    assert.deepEqual(evidence.items.map(item => item.record.id), ["A", "b", "\ue000", "\u{10000}"]);
    assert.deepEqual(evidence.items.map(item => item.ranks), [1, 2, 3, 4].map(rank => ({ dense: rank, lexical: rank })));
  } finally { await value.cleanup(); }
});

test("retrieval survives cross-runtime reopen with identical IDs ranks scores and revisions", async () => {
  const value = fixture();
  try {
    const memory = await value.open();
    await memory.upsert([{ id: "a", sourceId: "s", text: "red apple" },
      { id: "b", sourceId: "s", text: "blue ocean" }, { id: "c", sourceId: "s", text: "green leaf" }]);
    const expected = await memory.search("apple");
    await memory.close();
    const runtime = process.versions.bun ? "node" : "bun";
    const script = fileURLToPath(new URL("./retrieval-runtime-read.js", import.meta.url));
    const actual = JSON.parse(execFileSync(runtime, [script, value.path], { encoding: "utf8" })) as Evidence;
    assert.deepEqual(actual, expected);
  } finally { await value.cleanup(); }
});
