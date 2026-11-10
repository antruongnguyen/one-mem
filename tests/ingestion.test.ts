import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { MemoryError } from "../dist/index.js";
import { openStorage } from "../dist/storage.js";
import { temporaryMemory } from "./memory-fixtures.js";

const a = { id: "a", sourceId: "s", text: "red apple" };

test("persists exact text and provenance", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    const input = { id: " a ", sourceId: " s ", text: "  tiếng Việt\n🙂 red apple  ",
      sessionId: " session ", sequence: 0, speaker: "", observedAt: "2026-11-10T12:30:00+07:00",
      eventAt: "2026-11-09T09:00:00-02:00" };
    const result = await memory.upsert([input]);
    const record = await memory.get(input.id);
    assert.deepEqual(record, { ...input, observedAt: "2026-11-10T05:30:00.000Z",
      eventAt: "2026-11-09T11:00:00.000Z", revision: result.records[0].revision });
    assert.match(record!.revision, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await memory.close();
    assert.deepEqual(await (await fixture.open()).get(input.id), record);
    const db = openStorage(fixture.path);
    try {
      const row = db.prepare<unknown[], { content_hash: string; embedding: Buffer }>(
        "SELECT content_hash, embedding FROM records WHERE id = ?",
      ).get(input.id)!;
      assert.equal(row.content_hash, createHash("sha256").update(JSON.stringify([
        input.id, input.sourceId, input.text, input.sessionId, input.sequence, input.speaker,
        record!.observedAt, record!.eventAt,
      ])).digest("hex"));
      assert.equal(row.embedding.byteLength, 8);
      assert.equal(row.embedding.readFloatLE(0), 1);
      assert.equal(row.embedding.readFloatLE(4), 0);
    } finally { db.close(); }
  } finally { await fixture.cleanup(); }
});

test("same input is unchanged", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    const first = await memory.upsert([a]);
    assert.equal(first.records[0].status, "inserted");
    assert.deepEqual(await memory.upsert([a]), { records: [{ ...first.records[0], status: "unchanged" }] });
    assert.deepEqual(fixture.embeddings.inputs, ["red apple"]);
    assert.deepEqual(await memory.upsert([]), { records: [] });
  } finally { await fixture.cleanup(); }
});

test("same text in two sources remains two records", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    await memory.upsert([a, { ...a, id: "b", sourceId: "other" }]);
    assert.equal((await memory.get("a"))?.sourceId, "s");
    assert.equal((await memory.get("b"))?.sourceId, "other");
    assert.equal((await memory.get("b"))?.text, "red apple");
    assert.equal(fixture.embeddings.inputs.length, 2);
  } finally { await fixture.cleanup(); }
});

test("metadata update reuses vector", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    const first = (await memory.upsert([a])).records[0];
    const second = (await memory.upsert([{ ...a, speaker: "reader" }])).records[0];
    assert.equal(second.status, "updated");
    assert.notEqual(first.revision, second.revision);
    assert.equal(fixture.embeddings.inputs.length, 1);
    await memory.upsert([{ ...a, text: "blue ocean" }]);
    assert.deepEqual(fixture.embeddings.inputs, ["red apple", "blue ocean"]);
  } finally { await fixture.cleanup(); }
});

test("later conflicting observations survive explicit replacement", async () => {
  const fixture = temporaryMemory();
  try {
    let memory = await fixture.open();
    const old = { ...a, text: "The office is in Hanoi.", observedAt: "2026-01-01T00:00:00Z" };
    const newer = { id: "b", sourceId: "s", text: "The office moved to Da Nang.",
      observedAt: "2026-02-01T00:00:00Z", eventAt: "2026-01-31T00:00:00Z" };
    const revision = (await memory.upsert([old, newer])).records[0].revision;
    await memory.close();
    memory = await fixture.open();
    assert.equal((await memory.get("a"))?.text, old.text);
    const later = await memory.get("b");
    assert.equal(later?.text, newer.text);
    const correction = (await memory.upsert([{ ...old, text: "The former office was in Hue." }])).records[0];
    assert.notEqual(correction.revision, revision);
    assert.equal((await memory.get("a"))?.text, "The former office was in Hue.");
    assert.deepEqual(await memory.get("b"), later);
  } finally { await fixture.cleanup(); }
});

test("invalid batch writes nothing", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    for (const records of [[a, { ...a, id: "" }], [a, a]]) {
      await assert.rejects(memory.upsert(records), { code: "INVALID_INPUT" });
      assert.equal(await memory.get("a"), undefined);
    }
    assert.equal(fixture.embeddings.inputs.length, 0);
  } finally { await fixture.cleanup(); }
});

test("provider failure writes nothing", async () => {
  const fixture = temporaryMemory();
  const cause = new Error("provider unavailable");
  try {
    const memory = await fixture.open({ embeddings: { space: fixture.embeddings.space,
      async embed() { throw cause; } } });
    await assert.rejects(memory.upsert([a]), error => {
      assert.ok(error instanceof MemoryError);
      assert.equal(error.code, "PROVIDER_FAILURE");
      assert.equal(error.cause, cause);
      return true;
    });
    assert.equal(await memory.get("a"), undefined);
  } finally { await fixture.cleanup(); }
});

for (const [name, vectors] of [
  ["wrong count", []], ["extra count", [new Float32Array([1, 0]), new Float32Array([1, 0])]],
  ["wrong dimension", [new Float32Array([1])]], ["NaN", [new Float32Array([NaN, 1])]],
  ["Infinity", [new Float32Array([Infinity, 1])]], ["zero norm", [new Float32Array([0, 0])]],
] as const) {
  test(`invalid ${name} vector writes nothing`, async () => {
    const fixture = temporaryMemory();
    try {
      const memory = await fixture.open({ embeddings: { space: fixture.embeddings.space,
        async embed() { return vectors; } } });
      await assert.rejects(memory.upsert([a]), { code: "EMBEDDING_MISMATCH" });
      assert.equal(await memory.get("a"), undefined);
    } finally { await fixture.cleanup(); }
  });
}

test("vectors are normalized as finite little-endian Float32 values", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open({ embeddings: { space: fixture.embeddings.space,
      async embed() { return [new Float32Array([3, 4])]; } } });
    await memory.upsert([a]);
    const db = openStorage(fixture.path);
    try {
      const row = db.prepare<[], { embedding: Buffer }>("SELECT embedding FROM records").get()!;
      assert.ok(Math.abs(row.embedding.readFloatLE(0) - 0.6) < 1e-7);
      assert.ok(Math.abs(row.embedding.readFloatLE(4) - 0.8) < 1e-7);
    } finally { db.close(); }
  } finally { await fixture.cleanup(); }
});

test("atomic ordinal swaps retain both records", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    const first = { ...a, sessionId: "day", sequence: 1 };
    const second = { ...first, id: "b", text: "blue ocean", sequence: 2 };
    await memory.upsert([first, second]);
    await memory.upsert([{ ...first, sequence: 2 }, { ...second, sequence: 1 }]);
    assert.equal((await memory.get("a"))?.sequence, 2);
    assert.equal((await memory.get("b"))?.sequence, 1);
    assert.equal(fixture.embeddings.inputs.length, 2);
  } finally { await fixture.cleanup(); }
});

test("failed batch rolls back records FTS and vectors", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    const first = { ...a, sessionId: "day", sequence: 1 };
    const second = { ...first, id: "b", text: "blue ocean", sequence: 2 };
    await memory.upsert([first, second]);
    const original = await memory.get("a");
    await assert.rejects(memory.upsert([{ ...first, text: "green leaf", sequence: 2 },
      { id: "c", sourceId: "s", text: "new term" }]), { code: "CONFLICT" });
    assert.deepEqual(await memory.get("a"), original);
    assert.equal(await memory.get("c"), undefined);
    const db = openStorage(fixture.path);
    try {
      const lexical = (text: string) => db.prepare<unknown[], { id: string }>(
        "SELECT r.id FROM records_fts JOIN records r ON r.row_id = records_fts.rowid WHERE records_fts MATCH ?",
      ).all(text).map(row => row.id);
      assert.deepEqual(lexical("apple"), ["a"]);
      assert.deepEqual(lexical("leaf"), []);
      assert.deepEqual(lexical("term"), []);
      const row = db.prepare<unknown[], { embedding: Buffer }>("SELECT embedding FROM records WHERE id = ?").get("a")!;
      assert.equal(row.embedding.readFloatLE(0), 1);
      assert.equal(row.embedding.readFloatLE(4), 0);
    } finally { db.close(); }
  } finally { await fixture.cleanup(); }
});

test("delete and reinsert never reuse revision", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    const first = (await memory.upsert([a])).records[0].revision;
    assert.equal(await memory.remove(["a", "a", "missing"]), 1);
    assert.equal(await memory.get("a"), undefined);
    assert.equal(await memory.remove([]), 0);
    const second = (await memory.upsert([a])).records[0].revision;
    assert.notEqual(first, second);
    await memory.remove(["a"]);
    const db = openStorage(fixture.path);
    try {
      assert.deepEqual(db.prepare("SELECT rowid FROM records_fts WHERE records_fts MATCH 'apple'").all(), []);
      assert.deepEqual(db.prepare("SELECT embedding FROM records").all(), []);
    } finally { db.close(); }
  } finally { await fixture.cleanup(); }
});

test("sparse input and removal arrays are invalid without partial writes", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    const sparseInputs = [a];
    sparseInputs.length = 2;
    await assert.rejects(memory.upsert(sparseInputs), { code: "INVALID_INPUT" });
    assert.equal(await memory.get("a"), undefined);
    assert.equal(fixture.embeddings.inputs.length, 0);
    await memory.upsert([a]);
    const sparseIds = ["a"];
    sparseIds.length = 2;
    await assert.rejects(memory.remove(sparseIds), { code: "INVALID_INPUT" });
    assert.equal((await memory.get("a"))?.text, "red apple");
  } finally { await fixture.cleanup(); }
});

test("sparse provider output rejects the full batch", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open({ embeddings: { space: fixture.embeddings.space,
      async embed() {
        const vectors = [new Float32Array([1, 0])];
        vectors.length = 2;
        return vectors;
      } } });
    await assert.rejects(memory.upsert([a, { ...a, id: "b" }]), { code: "EMBEDDING_MISMATCH" });
    assert.equal(await memory.get("a"), undefined);
    assert.equal(await memory.get("b"), undefined);
  } finally { await fixture.cleanup(); }
});

test("cancellation reason is preserved even when it resembles a SQLite error", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    const reason = Object.assign(new Error("caller cancellation"), { code: "SQLITE_BUSY" });
    const controller = new AbortController();
    controller.abort(reason);
    await assert.rejects(memory.upsert([a], { signal: controller.signal }), error => error === reason);
    assert.equal(await memory.get("a"), undefined);
  } finally { await fixture.cleanup(); }
});

test("successful replacement removes old FTS terms and persists the new vector", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    await memory.upsert([a]);
    await memory.upsert([{ ...a, text: "blue ocean" }]);
    await memory.close();
    const db = openStorage(fixture.path);
    try {
      assert.deepEqual(db.prepare("SELECT rowid FROM records_fts WHERE records_fts MATCH 'apple'").all(), []);
      assert.equal(db.prepare("SELECT rowid FROM records_fts WHERE records_fts MATCH 'ocean'").all().length, 1);
      const vector = db.prepare<[], { embedding: Buffer }>("SELECT embedding FROM records").get()!.embedding;
      assert.equal(vector.readFloatLE(0), 0);
      assert.equal(vector.readFloatLE(4), 1);
    } finally { db.close(); }
  } finally { await fixture.cleanup(); }
});

test("unpaired Unicode surrogates reject whole batches before embedding", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    for (const field of ["id", "sourceId", "text", "speaker"]) {
      await assert.rejects(memory.upsert([a, { id: "bad", sourceId: "s", text: "blue ocean", [field]: "bad\ud800" }]),
        { code: "INVALID_INPUT" });
      assert.equal(await memory.get("a"), undefined);
    }
    await assert.rejects(memory.upsert([a, { id: "bad", sourceId: "s", text: "blue ocean", sessionId: "bad\udfff", sequence: 1 }]),
      { code: "INVALID_INPUT" });
    assert.equal(fixture.embeddings.inputs.length, 0);
    await assert.rejects(memory.get("bad\ud800"), { code: "INVALID_INPUT" });
    await memory.upsert([a]);
    await assert.rejects(memory.remove(["a", "bad\udfff"]), { code: "INVALID_INPUT" });
    assert.equal((await memory.get("a"))?.text, "red apple");
  } finally { await fixture.cleanup(); }
});

test("valid astral Unicode and embedded NUL preserve exact record strings", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    const input = { id: "🙂\0id", sourceId: "🌱\0source", text: "red\0apple 🙂", speaker: "👩‍💻\0speaker" };
    const result = await memory.upsert([input]);
    assert.deepEqual(await memory.get(input.id), { ...input, revision: result.records[0].revision });
    assert.equal(await memory.get("🙂"), undefined);
  } finally { await fixture.cleanup(); }
});
