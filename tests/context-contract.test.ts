import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openMemory } from "../dist/index.js";
import type { EmbeddingProvider, MemoryInput } from "../dist/index.js";

function provider(): EmbeddingProvider & { queryCalls: number } {
  return {
    space: { id: "context-contract-v1", dimensions: 2, metric: "cosine" },
    queryCalls: 0,
    async embed(texts, options) {
      if (options.purpose === "query") this.queryCalls++;
      return texts.map(text => new Float32Array(options.purpose === "query" || text.startsWith("anchor") ? [1, 0] : [0, 1]));
    },
  };
}
const turn = (id: string, sequence: number, text = id, sessionId = "day"): MemoryInput => ({
  id, sourceId: "source", sessionId, sequence, text,
});

test("neighbor radius validates before the empty fast path and zero preserves matched results", async () => {
  const embeddings = provider();
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings });
  try {
    for (const neighbors of [-1, 3, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, "1"]) {
      await assert.rejects(memory.search("anchor", { neighbors: neighbors as number }), { code: "INVALID_INPUT" });
    }
    assert.equal(embeddings.queryCalls, 0);
    await memory.upsert([turn("a", 1, "anchor"), turn("b", 2)]);
    assert.deepEqual(await memory.search("anchor", { limit: 1, neighbors: 0 }), await memory.search("anchor", { limit: 1 }));
    assert.deepEqual((await memory.search("anchor", { limit: 1 })).items[0]?.anchorIds, []);
  } finally {
    await memory.close();
  }
});

test("radius two orders context by sequence and never expands it recursively", async () => {
  const embeddings = provider();
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings });
  try {
    await memory.upsert([turn("a", 10, "anchor"), ...[8, 9, 11, 12, 13].map(n => turn(`t${n}`, n))]);
    const result = await memory.search("anchor", { limit: 1, neighbors: 2 });
    assert.deepEqual(result.items.map(item => item.record.id), ["a", "t8", "t9", "t11", "t12"]);
    for (const item of result.items.slice(1)) {
      assert.equal(item.role, "context");
      assert.equal(item.score, null);
      assert.deepEqual(item.ranks, {});
      assert.deepEqual(item.anchorIds, ["a"]);
    }
    assert.equal(embeddings.queryCalls, 1);
  } finally {
    await memory.close();
  }
});

test("neighbor walks respect both ends of the safe sequence domain", async () => {
  const max = Number.MAX_SAFE_INTEGER;
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings: provider() });
  try {
    await memory.upsert([
      turn("a-low", 0, "anchor", "low"), turn("low-one", 1, "one", "low"), turn("low-two", 2, "two", "low"),
      turn("b-high", max, "anchor", "high"), turn("high-one", max - 1, "one", "high"), turn("high-two", max - 2, "two", "high"),
    ]);
    const result = await memory.search("anchor", { limit: 2, neighbors: 2 });
    assert.deepEqual(result.items.map(item => item.record.id), ["a-low", "b-high", "low-one", "low-two", "high-two", "high-one"]);
    assert.deepEqual(result.items.slice(-2).map(item => item.record.sequence), [max - 2, max - 1]);
  } finally {
    await memory.close();
  }
});

test("a gap stops only its direction and another scope cannot fill it", async () => {
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings: provider() });
  try {
    await memory.upsert([
      turn("a", 10, "anchor"), turn("left-behind-gap", 8), turn("right", 11), turn("right-behind-gap", 13),
      turn("foreign-session", 9, "foreign", "other"),
      { ...turn("foreign-source", 9), sourceId: "other" },
    ]);
    const result = await memory.search("anchor", { sourceId: "source", sessionId: "day", limit: 1, neighbors: 2 });
    assert.deepEqual(result.items.map(item => item.record.id), ["a", "right"]);
  } finally {
    await memory.close();
  }
});

test("an oversized adjacent record preserves continuity to smaller context", async () => {
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings: provider() });
  try {
    await memory.upsert([
      turn("a", 10, "anchor"), turn("eight", 8, "é"), turn("nine", 9, "X".repeat(100)),
      turn("eleven", 11, "🙂"), turn("twelve", 12, "B"),
    ]);
    const result = await memory.search("anchor", { limit: 1, neighbors: 2, maxEvidenceBytes: 13 });
    assert.deepEqual(result.items.map(item => item.record.id), ["a", "eight", "eleven", "twelve"]);
    assert.equal(result.diagnostics.usedBytes, 13);
    assert.equal(result.diagnostics.budgetOmitted, 1);
    assert.deepEqual(result.items.map(item => item.record.text), ["anchor", "é", "🙂", "B"]);
  } finally {
    await memory.close();
  }
});

test("a record omitted as a match is not counted twice when visited as context", async () => {
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings: provider() });
  try {
    await memory.upsert([
      turn("a-large", 2, `anchor${" ".repeat(100)}`), turn("b-selected", 3, "anchor"), turn("leaf", 1, "leaf"),
    ]);
    const result = await memory.search("anchor", { limit: 1, neighbors: 2, maxEvidenceBytes: 10 });
    assert.deepEqual(result.items.map(item => item.record.id), ["b-selected", "leaf"]);
    assert.equal(result.diagnostics.budgetOmitted, 1);
    assert.equal(result.diagnostics.usedBytes, 10);
    assert.deepEqual(result.items[1]?.anchorIds, ["b-selected"]);
  } finally {
    await memory.close();
  }
});

test("shared context consumes bytes once and gains anchors in match-rank order", async () => {
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings: provider() });
  try {
    await memory.upsert([turn("a", 1, "anchor"), turn("b", 3, "anchor"), turn("middle", 2, "Z")]);
    const full = await memory.search("anchor", { limit: 2, neighbors: 1, maxEvidenceBytes: 13 });
    assert.deepEqual(full.items.map(item => item.record.id), ["a", "b", "middle"]);
    assert.deepEqual(full.items[2]?.anchorIds, ["a", "b"]);
    assert.equal(full.diagnostics.usedBytes, 13);
    const tight = await memory.search("anchor", { limit: 2, neighbors: 1, maxEvidenceBytes: 12 });
    assert.deepEqual(tight.items.map(item => item.record.id), ["a", "b"]);
    assert.equal(tight.diagnostics.budgetOmitted, 1);
  } finally {
    await memory.close();
  }
});

test("a selected match reached by another anchor keeps its score ranks and empty anchors", async () => {
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings: provider() });
  try {
    await memory.upsert([turn("a", 1, "anchor"), turn("b", 2, "anchor"), turn("before", 0), turn("after", 3)]);
    const result = await memory.search("anchor", { limit: 2, neighbors: 1 });
    assert.deepEqual(result.items.map(item => item.record.id), ["a", "b", "before", "after"]);
    for (const item of result.items.slice(0, 2)) {
      assert.equal(item.role, "match");
      assert.ok(typeof item.score === "number" && item.score > 0);
      assert.ok(item.ranks.dense && item.ranks.lexical);
      assert.deepEqual(item.anchorIds, []);
    }
  } finally {
    await memory.close();
  }
});

test("speaker and timestamps alone do not create a context session", async () => {
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings: provider() });
  try {
    await memory.upsert([
      { id: "a", sourceId: "source", text: "anchor", speaker: "user", observedAt: "2026-11-10T00:00:00Z" },
      { ...turn("nearby-time", 1), observedAt: "2026-11-10T00:00:01Z" },
    ]);
    const result = await memory.search("anchor", { limit: 1, neighbors: 2 });
    assert.deepEqual(result.items.map(item => item.record.id), ["a"]);
    assert.equal(result.items[0]?.record.eventAt, undefined);
  } finally {
    await memory.close();
  }
});

test("context reflects metadata writes during inference and remains detached after deletion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "one-mem context snapshot "));
  const path = join(directory, "memory.sqlite");
  const embeddings = provider();
  const memory = await openMemory({ path, namespace: "test", embeddings });
  const other = await openMemory({ path, namespace: "test", embeddings: provider() });
  try {
    const context = { ...turn("context", 9, "earlier event", "other"), sourceId: "other", observedAt: "2030-01-01T00:00:00Z", eventAt: "2020-01-01T00:00:00Z" };
    await memory.upsert([turn("a", 10, "anchor"), context]);
    const old = await memory.get("context");
    const normalEmbed = embeddings.embed;
    embeddings.embed = async () => {
      await other.upsert([{ ...context, sourceId: "source", sessionId: "day", sequence: 11 }, turn("new", 12)]);
      return [new Float32Array([1, 0])];
    };
    const result = await memory.search("anchor", { limit: 1, neighbors: 2 });
    assert.deepEqual(result.items.map(item => item.record.id), ["a", "context", "new"]);
    const stored = result.items[1]!.record;
    assert.notEqual(stored.revision, old?.revision);
    assert.equal(stored.observedAt, "2030-01-01T00:00:00.000Z");
    assert.equal(stored.eventAt, "2020-01-01T00:00:00.000Z");
    await other.remove(["context", "new"]);
    assert.equal(stored.text, "earlier event");
    assert.equal(result.items.length, 3);
    embeddings.embed = normalEmbed;
    assert.deepEqual((await memory.search("anchor", { limit: 1, neighbors: 2 })).items.map(item => item.record.id), ["a"]);
  } finally {
    await other.close();
    await memory.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
