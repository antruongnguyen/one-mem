import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openMemory, MemoryError } from "../dist/index.js";
import { openStorage } from "../dist/storage.js";
import type { EmbeddingProvider, MemoryInput, OpenMemoryOptions } from "../dist/index.js";

function provider(): EmbeddingProvider & { calls: number } {
  return {
    calls: 0,
    space: { id: "contract-v1", dimensions: 2, metric: "cosine" },
    async embed(texts, options) {
      assert.equal(options.purpose, "document");
      this.calls += texts.length;
      return texts.map(() => new Float32Array([3, 4]));
    },
  };
}

const record = { id: "a", sourceId: "source", text: "red apple" };
const asInputs = (value: unknown) => value as readonly MemoryInput[];
const openOptions = (value: unknown) => value as OpenMemoryOptions;

test("open validates unsupported options before creating storage", async () => {
  for (const options of [
    null, {},
    { path: 42, namespace: "test", embeddings: provider() },
    { path: ":memory:", namespace: " ", embeddings: provider() },
    { path: ":memory:", namespace: "test", embeddings: null },
    { path: ":memory:", namespace: "test", embeddings: { space: provider().space } },
    { path: ":memory:", namespace: "test", embeddings: provider(), neighbors: 1 },
  ]) {
    await assert.rejects(openMemory(openOptions(options)), { code: "INVALID_INPUT" });
  }
});

test("invalid records and unsupported fields reject the entire batch before embedding", async () => {
  const embeddings = provider();
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings });
  try {
    const badRecords = [
      null, 42, {},
      { ...record, id: "\t" }, { ...record, id: 1 },
      { ...record, sourceId: " " }, { ...record, text: "\n" },
      { ...record, speaker: 42 }, { ...record, metadata: {} },
      { ...record, sessionId: "" }, { ...record, sessionId: "session" },
      { ...record, sequence: 0 },
      ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity].map(sequence => ({ ...record, sessionId: "session", sequence })),
      { ...record, sessionId: "session", sequence: null },
    ];
    for (const invalid of badRecords) {
      await assert.rejects(memory.upsert(asInputs([{ ...record, id: "valid" }, invalid])), { code: "INVALID_INPUT" });
      assert.equal(await memory.get("valid"), undefined);
    }
    await assert.rejects(memory.upsert(asInputs(null)), { code: "INVALID_INPUT" });
    await assert.rejects(memory.upsert([record, record]), { code: "INVALID_INPUT" });
    assert.equal(embeddings.calls, 0);
  } finally {
    await memory.close();
  }
});

test("timestamps reject calendar rollover and require an explicit offset", async () => {
  const embeddings = provider();
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings });
  try {
    for (const timestamp of [
      "", "2026-11-10", "2026-11-10T08:00:00", "not a date",
      "2026-02-29T00:00:00Z", "2024-02-30T00:00:00Z", "2026-04-31T00:00:00Z",
      "2026-13-01T00:00:00Z", "2026-00-01T00:00:00Z", "2026-01-00T00:00:00Z",
      "2026-11-10T24:00:00Z", "2026-11-10T23:60:00Z", "2026-11-10T23:00:60Z",
      "2026-11-10T08:00:00+24:00", "2026-11-10T08:00:00+07:60",
    ]) {
      for (const field of ["observedAt", "eventAt"]) {
        await assert.rejects(memory.upsert([{ ...record, [field]: timestamp }]), { code: "INVALID_INPUT" });
      }
    }
    assert.equal(embeddings.calls, 0);
  } finally {
    await memory.close();
  }
});

test("timestamp normalization preserves canonical identity and exact source strings", async () => {
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings: provider() });
  try {
    const input = { id: " a ", sourceId: " source ", text: "  exact é 🙂\n", observedAt: "2024-02-29T15:00:00.123+07:00", eventAt: "2024-02-29T03:00:00.123-05:00" };
    const first = await memory.upsert([input]);
    const stored = await memory.get(input.id);
    assert.equal(stored?.text, input.text);
    assert.equal(stored?.id, input.id);
    assert.equal(stored?.sourceId, input.sourceId);
    assert.equal(stored?.observedAt, "2024-02-29T08:00:00.123Z");
    assert.equal(stored?.eventAt, "2024-02-29T08:00:00.123Z");
    const second = await memory.upsert([{ ...input, observedAt: stored!.observedAt, eventAt: stored!.eventAt }]);
    assert.equal(second.records[0]?.status, "unchanged");
    assert.equal(second.records[0]?.revision, first.records[0]?.revision);
    assert.equal(await memory.get("a"), undefined);
  } finally {
    await memory.close();
  }
});

test("optional metadata stays absent and the largest safe sequence round trips", async () => {
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings: provider() });
  try {
    await memory.upsert([record, { ...record, id: "b", sessionId: "session", sequence: Number.MAX_SAFE_INTEGER }]);
    const plain = await memory.get("a");
    assert.equal(plain?.observedAt, undefined);
    assert.equal(plain?.eventAt, undefined);
    assert.equal(plain?.sessionId, undefined);
    assert.equal((await memory.get("b"))?.sequence, Number.MAX_SAFE_INTEGER);
    assert.equal("search" in memory, true);
  } finally {
    await memory.close();
  }
});

test("upsert options and remove IDs are validated without partial changes", async () => {
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings: provider() });
  try {
    await memory.upsert([record]);
    for (const options of [null, { neighbors: 1 }, { signal: {} }]) {
      await assert.rejects(memory.upsert([record], options as unknown as Parameters<typeof memory.upsert>[1]), { code: "INVALID_INPUT" });
    }
    for (const ids of [null, "a", ["a", " "], ["a", 1]]) {
      await assert.rejects(memory.remove(ids as unknown as readonly string[]), { code: "INVALID_INPUT" });
      assert.equal((await memory.get("a"))?.text, record.text);
    }
    await assert.rejects(memory.get(" "), { code: "INVALID_INPUT" });
    assert.deepEqual(await memory.upsert([]), { records: [] });
    assert.equal(await memory.remove([]), 0);
  } finally {
    await memory.close();
  }
});

test("aborted input never reaches the provider and a failed operation does not poison the queue", async () => {
  const embeddings = provider();
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings });
  try {
    const controller = new AbortController();
    const reason = new Error("cancelled by caller");
    controller.abort(reason);
    await assert.rejects(memory.upsert([record], { signal: controller.signal }), error => error === reason);
    assert.equal(embeddings.calls, 0);
    await assert.rejects(memory.upsert(asInputs([{ ...record, text: "" }])), { code: "INVALID_INPUT" });
    assert.equal((await memory.upsert([record])).records[0]?.status, "inserted");
    assert.equal(embeddings.calls, 1);
  } finally {
    await memory.close();
  }
});

test("in-flight cancellation cannot commit provider output", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel while embedding");
  const embeddings = provider();
  embeddings.embed = async texts => {
    controller.abort(reason);
    return texts.map(() => new Float32Array([1, 0]));
  };
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings });
  try {
    await assert.rejects(memory.upsert([record], { signal: controller.signal }), error => error === reason);
    assert.equal(await memory.get("a"), undefined);
  } finally {
    await memory.close();
  }
});

test("provider descriptors are copied and mutation during embedding rejects writes", async () => {
  const embeddings = provider();
  const originalSpace = embeddings.space;
  embeddings.embed = async texts => {
    originalSpace.id = "different-model";
    return texts.map(() => new Float32Array([1, 0]));
  };
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings });
  try {
    assert.equal(Object.isFrozen(originalSpace), false);
    await assert.rejects(memory.upsert([record]), { code: "EMBEDDING_MISMATCH" });
    assert.equal(await memory.get("a"), undefined);
  } finally {
    await memory.close();
  }
});

test("provider exceptions cannot impersonate library error codes", async () => {
  const cause = new MemoryError("CLOSED", "provider error");
  const embeddings = provider();
  embeddings.embed = async () => { throw cause; };
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings });
  try {
    await assert.rejects(memory.upsert([record]), error => error instanceof MemoryError && error.code === "PROVIDER_FAILURE" && error.cause === cause);
    assert.equal(await memory.get("a"), undefined);
  } finally {
    await memory.close();
  }
});

test("embedding work cannot change the captured input record", async () => {
  const input = { ...record };
  const embeddings = provider();
  embeddings.embed = async texts => {
    assert.deepEqual(texts, [record.text]);
    input.text = "changed during embedding";
    input.sourceId = "different source";
    return [new Float32Array([1, 0])];
  };
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings });
  try {
    await memory.upsert([input]);
    const stored = await memory.get(record.id);
    assert.equal(stored?.text, record.text);
    assert.equal(stored?.sourceId, record.sourceId);
  } finally {
    await memory.close();
  }
});

test("stored vectors use normalized little-endian Float32 bytes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "one-mem vector contract "));
  const path = join(directory, "memory.sqlite");
  try {
    const memory = await openMemory({ path, namespace: "test", embeddings: provider() });
    try {
      await memory.upsert([record]);
    } finally {
      await memory.close();
    }
    const db = openStorage(path);
    try {
      const row = db.prepare("SELECT embedding FROM records WHERE id = ?").get(record.id) as { embedding: Buffer };
      assert.equal(row.embedding.length, 8);
      assert.ok(Math.abs(row.embedding.readFloatLE(0) - 0.6) < 1e-6);
      assert.ok(Math.abs(row.embedding.readFloatLE(4) - 0.8) < 1e-6);
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
