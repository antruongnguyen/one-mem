import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Evidence, MemoryInput } from "../dist/index.js";
import { temporaryMemory } from "./memory-fixtures.js";

function fixture() {
  const value = temporaryMemory();
  value.embeddings.embed = async function(texts, options) {
    if (options.purpose === "document") this.inputs.push(...texts);
    return texts.map(text => new Float32Array(options.purpose === "query" || text === "anchor" ? [1, 0] : [0, 1]));
  };
  return value;
}

const turns: MemoryInput[] = [
  { id: "t1", sourceId: "s", sessionId: "day1", sequence: 1, text: "before" },
  { id: "t2", sourceId: "s", sessionId: "day1", sequence: 2, text: "anchor" },
  { id: "t3", sourceId: "s", sessionId: "day1", sequence: 3, text: "after" },
  { id: "t4", sourceId: "s", sessionId: "day1", sequence: 4, text: "last" },
];

test("neighbors stop at session and ordinal gaps", async () => {
  const value = fixture();
  try {
    const memory = await value.open();
    await memory.upsert([...turns,
      { id: "other-day", sourceId: "s", sessionId: "day2", sequence: 1, text: "elsewhere" },
      { id: "other-source", sourceId: "other", sessionId: "day1", sequence: 3, text: "elsewhere" }]);
    const evidence = await memory.search("anchor", { limit: 1, neighbors: 1 });
    assert.deepEqual(evidence.items.map(item => item.record.id), ["t2", "t1", "t3"]);
    assert.deepEqual(evidence.items.map(item => item.role), ["match", "context", "context"]);
    assert.deepEqual(evidence.items.map(item => item.anchorIds), [[], ["t2"], ["t2"]]);
    assert.equal(typeof evidence.items[0]!.score, "number");
    assert.deepEqual(evidence.items.slice(1).map(item => [item.score, item.ranks]), [[null, {}], [null, {}]]);
    await memory.remove(["t3"]);
    const gap = await memory.search("anchor", { limit: 1, neighbors: 2 });
    assert.deepEqual(gap.items.map(item => item.record.id), ["t2", "t1"]);
  } finally { await value.cleanup(); }
});

test("shared neighbor appears once", async () => {
  const value = fixture();
  try {
    const memory = await value.open();
    await memory.upsert([...turns.slice(0, 3), { ...turns[3]!, text: "anchor" },
      { id: "t5", sourceId: "s", sessionId: "day1", sequence: 5, text: "end" }]);
    const evidence = await memory.search("anchor", { limit: 2, neighbors: 1 });
    assert.deepEqual(evidence.items.map(item => item.record.id), ["t2", "t4", "t1", "t3", "t5"]);
    assert.deepEqual(evidence.items.map(item => item.anchorIds), [[], [], ["t2"], ["t2", "t4"], ["t4"]]);
    assert.equal(evidence.diagnostics.usedBytes, 26);
    assert.equal(evidence.diagnostics.budgetOmitted, 0);
  } finally { await value.cleanup(); }
});

test("matches retain priority over context", async () => {
  const value = fixture();
  try {
    const memory = await value.open();
    await memory.upsert([...turns.slice(0, 3), { ...turns[3]!, text: "anchor" }]);
    const evidence = await memory.search("anchor", { limit: 2, neighbors: 1, maxEvidenceBytes: 12 });
    assert.deepEqual(evidence.items.map(item => [item.record.id, item.role]), [["t2", "match"], ["t4", "match"]]);
    assert.equal(evidence.diagnostics.usedBytes, 12);
    assert.equal(evidence.diagnostics.budgetOmitted, 2);
  } finally { await value.cleanup(); }
});

test("limit counts matches while matching neighbors retain their match role", async () => {
  const value = fixture();
  try {
    const memory = await value.open();
    await memory.upsert([...turns.slice(0, 1), { ...turns[1]!, text: "anchor" }, { ...turns[2]!, text: "anchor" }]);
    const evidence = await memory.search("anchor", { limit: 2, neighbors: 1 });
    assert.deepEqual(evidence.items.map(item => [item.record.id, item.role]),
      [["t2", "match"], ["t3", "match"], ["t1", "context"]]);
    assert.deepEqual(evidence.items.map(item => item.anchorIds), [[], [], ["t2"]]);
  } finally { await value.cleanup(); }
});

test("default and zero neighbors return identical matches", async () => {
  const value = fixture();
  try {
    const memory = await value.open();
    await memory.upsert(turns);
    const evidence = await memory.search("anchor", { limit: 1 });
    assert.deepEqual(await memory.search("anchor", { limit: 1, neighbors: 0 }), evidence);
    assert.deepEqual(evidence.items.map(item => [item.record.id, item.role, item.anchorIds]), [["t2", "match", []]]);
  } finally { await value.cleanup(); }
});

test("records without session order receive no context", async () => {
  const value = fixture();
  try {
    const memory = await value.open();
    await memory.upsert([{ id: "anchor", sourceId: "s", text: "anchor", speaker: "same" },
      { id: "other", sourceId: "s", text: "before", speaker: "same" }]);
    const evidence = await memory.search("anchor", { limit: 1, neighbors: 2 });
    assert.deepEqual(evidence.items.map(item => item.record.id), ["anchor"]);
  } finally { await value.cleanup(); }
});

test("metadata corrections immediately change neighbor membership without inference", async () => {
  const value = fixture();
  try {
    const memory = await value.open();
    await memory.upsert(turns);
    const before = await memory.search("anchor", { limit: 1, neighbors: 1 });
    assert.deepEqual(before.items.map(item => item.record.id), ["t2", "t1", "t3"]);
    const calls = value.embeddings.inputs.length;
    await memory.upsert([{ ...turns[0]!, sessionId: "day2" }, { ...turns[2]!, sequence: 8 }]);
    assert.equal(value.embeddings.inputs.length, calls);
    assert.deepEqual((await memory.search("anchor", { limit: 1, neighbors: 2 })).items.map(item => item.record.id), ["t2"]);
    await memory.upsert([turns[2]!]);
    assert.deepEqual((await memory.search("anchor", { limit: 1, neighbors: 2 })).items.map(item => item.record.id), ["t2", "t3", "t4"]);
    await memory.remove(["t3"]);
    assert.deepEqual((await memory.search("anchor", { limit: 1, neighbors: 2 })).items.map(item => item.record.id), ["t2"]);
  } finally { await value.cleanup(); }
});

test("context evidence remains detached after source correction and deletion", async () => {
  const value = fixture();
  try {
    const memory = await value.open();
    await memory.upsert(turns);
    const evidence = await memory.search("anchor", { limit: 1, neighbors: 1 });
    const snapshot = structuredClone(evidence);
    const revision = evidence.items[1]!.record.revision;
    await memory.upsert([{ ...turns[0]!, text: "corrected" }]);
    await memory.remove(["t3"]);
    assert.deepEqual(evidence, snapshot);
    assert.equal(evidence.items[1]!.record.text, "before");
    assert.equal(evidence.items[1]!.record.revision, revision);
    assert.notEqual((await memory.get("t1"))!.revision, revision);
  } finally { await value.cleanup(); }
});

test("context survives cross-runtime reopen with identical provenance and bytes", async () => {
  const value = fixture();
  try {
    const memory = await value.open();
    await memory.upsert([...turns.slice(0, 3), { ...turns[3]!, text: "anchor" }]);
    const expected = await memory.search("anchor", { limit: 2, neighbors: 1 });
    await memory.close();
    const runtime = process.versions.bun ? "node" : "bun";
    const script = fileURLToPath(new URL("./context-runtime-read.js", import.meta.url));
    const actual = JSON.parse(execFileSync(runtime, [script, value.path], { encoding: "utf8" })) as Evidence;
    assert.deepEqual(actual, expected);
    assert.deepEqual(actual.items.map(item => item.record.id), ["t2", "t4", "t1", "t3"]);
  } finally { await value.cleanup(); }
});
