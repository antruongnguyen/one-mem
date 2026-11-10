import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as api from "one-mem";

const [operation, path, writer] = process.argv.slice(2);
const runtime = process.versions.bun ? "bun" : "node";
const entry = fileURLToPath(import.meta.resolve("one-mem"));
assert.equal(entry, resolve("node_modules/one-mem/dist/index.js"));
assert.deepEqual(Object.keys(api).sort(), ["MemoryError", "openMemory"]);
if (runtime === "node") assert.equal(typeof globalThis.Bun, "undefined");
for (const subpath of ["one-mem/dist/storage.js", "one-mem/evaluation"]) {
  // Bun reports blocked package subpaths as ERR_MODULE_NOT_FOUND.
  await assert.rejects(import(subpath), { code: runtime === "bun" ? "ERR_MODULE_NOT_FOUND" : "ERR_PACKAGE_PATH_NOT_EXPORTED" });
}

const require = createRequire(import.meta.resolve("one-mem"));
const Driver = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const db = new Driver(":memory:");
try {
  sqliteVec.load(db);
  assert.equal(typeof db.prepare("SELECT vec_version() AS version").get().version, "string");
  assert.equal(db.prepare("SELECT vec_distance_cosine('[1,0]', '[1,0]') AS distance").get().distance, 0);
  db.exec("CREATE VIRTUAL TABLE lexical USING fts5(text); INSERT INTO lexical VALUES ('package needle');");
  assert.equal(db.prepare("SELECT count(*) AS count FROM lexical WHERE lexical MATCH 'needle'").get().count, 1);
} finally {
  db.close();
}

const embeddings = {
  space: { id: "package-consumer-v1", dimensions: 2, metric: "cosine" },
  async embed(texts) {
    return texts.map(text => Float32Array.from(text.includes("needle") ? [1, 0] : [0, 1]));
  },
};
const options = { path, namespace: "package-consumer", embeddings };
let memory = await api.openMemory(options);
try {
  if (operation === "exercise") {
    const records = [
      { id: "before", sourceId: "source", sessionId: "session", sequence: 0, text: "Trước 🙂" },
      { id: "anchor", sourceId: "source", sessionId: "session", sequence: 1, text: "needle Ω42" },
      { id: "after", sourceId: "source", sessionId: "session", sequence: 2, text: "Sau é" },
    ];
    const inserted = await memory.upsert(records);
    assert(inserted.records.every(record => record.status === "inserted"));
    const original = await memory.get("anchor");
    assert.equal(original.text, records[1].text);
    assert.equal(original.revision, inserted.records[1].revision);
    assert((await memory.upsert(records)).records.every(record => record.status === "unchanged"));
    const evidence = await memory.search("needle", {
      sourceId: "source", sessionId: "session", limit: 1, neighbors: 1, maxEvidenceBytes: 128,
    });
    assert.deepEqual(evidence.items.map(item => [item.record.id, item.role]), [
      ["anchor", "match"], ["before", "context"], ["after", "context"],
    ]);
    assert.equal(evidence.diagnostics.denseCandidates, 3);
    assert.equal(evidence.diagnostics.lexicalCandidates, 1);
    assert.equal(evidence.items[0].ranks.dense, 1);
    assert.equal(evidence.items[0].ranks.lexical, 1);
    assert.equal(evidence.diagnostics.usedBytes, records.reduce((sum, record) => sum + Buffer.byteLength(record.text), 0));
    assert.deepEqual((await memory.search("needle", { sourceId: "other" })).items, []);
    await assert.rejects(memory.search("needle", { mode: "dense" }), { code: "INVALID_INPUT" });
    const updated = await memory.upsert([{ ...records[1], text: "needle revised" }]);
    assert.equal(updated.records[0].status, "updated");
    assert.notEqual(updated.records[0].revision, original.revision);
    assert.equal(evidence.items[0].record.text, original.text);
    assert.equal(await memory.remove(["after", "missing"]), 1);
    assert.equal(await memory.get("after"), undefined);
    await memory.close();
    await memory.close();
    await assert.rejects(memory.get("anchor"), { code: "CLOSED" });
    memory = await api.openMemory(options);
    assert.equal((await memory.get("anchor")).text, "needle revised");
    assert.equal((await memory.get("anchor")).revision, updated.records[0].revision);
    assert.equal(await memory.get("after"), undefined);
    assert.deepEqual((await memory.search("needle", { limit: 1, neighbors: 1 })).items.map(item => item.record.id), ["anchor", "before"]);
  } else if (operation === "write") {
    await memory.upsert([{ id: writer, sourceId: writer, text: `needle written by ${writer} 🙂` }]);
  } else {
    assert.equal(operation, "read");
    const record = await memory.get(writer);
    assert.equal(record.text, `needle written by ${writer} 🙂`);
    assert.equal((await memory.search("needle", { sourceId: writer })).items[0].record.revision, record.revision);
  }
} finally {
  await memory.close();
}
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.resolve("one-mem")), "utf8"));
console.log(`${runtime} ${operation}: ${manifest.name}@${manifest.version}, native SQLite/vec/FTS and installed entry verified`);
