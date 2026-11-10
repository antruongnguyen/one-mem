import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openMemory } from "../dist/index.js";
import type { EmbeddingProvider, MemoryInput } from "../dist/index.js";
import { initializeMemory, openStorage } from "../dist/storage.js";

const namespace = "fixture-v1";
const space = { id: "fixture-space-v1", dimensions: 2, metric: "cosine" as const };
const originals: MemoryInput[] = [
  { id: "old-a", sourceId: "source:legacy", text: "Cobalt ZX-81 repair", sessionId: "session:legacy", sequence: 0,
    speaker: "user", observedAt: "2020-01-02T03:04:05.000Z", eventAt: "2019-12-01T00:00:00.000Z" },
  { id: "old-b", sourceId: "source:legacy", text: "Tài liệu gốc — α\nline two", sessionId: "session:legacy", sequence: 1 },
];
const revisions = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
function provider(): EmbeddingProvider & { documentInputs: number } {
  return {
    space: { ...space }, documentInputs: 0,
    async embed(texts, options) {
      if (options.purpose === "document") this.documentInputs += texts.length;
      return texts.map(() => new Float32Array([1, 0]));
    },
  };
}
function createVersionOne(path: string): void {
  const db = openStorage(path, false);
  try {
    db.exec(readFileSync(new URL("../tests/fixtures/schema-v1.sql", import.meta.url), "utf8"));
  } finally {
    db.close();
  }
}

test("frozen schema v1 preserves exact records revisions and vectors through reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "one-mem schema fixture "));
  const path = join(directory, "old.sqlite");
  try {
    createVersionOne(path);
    const embeddings = provider();
    const memory = await openMemory({ path, namespace, embeddings });
    try {
      for (const [index, original] of originals.entries()) {
        assert.deepEqual(await memory.get(original.id), { ...original, revision: revisions[index] });
      }
      assert.ok((await memory.upsert(originals)).records.every(record => record.status === "unchanged"));
      assert.equal(embeddings.documentInputs, 0);
      const evidence = await memory.search("ZX-81", { limit: 1, neighbors: 1 });
      assert.deepEqual(evidence.items.map(item => item.record.id), ["old-a", "old-b"]);
      assert.deepEqual(evidence.items.map(item => item.role), ["match", "context"]);
    } finally {
      await memory.close();
    }
    const db = openStorage(path);
    try {
      assert.equal(db.pragma("user_version", { simple: true }), 1n);
      assert.deepEqual(db.prepare("SELECT row_id, hex(embedding) AS vector FROM records ORDER BY id").all(), [
        { row_id: 9007199254740993n, vector: "0000803F00000000" },
        { row_id: 9007199254740994n, vector: "000000000000803F" },
      ]);
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed initialization rolls back real schema DDL before retry", () => {
  const db = openStorage(":memory:", false);
  const originalPrepare = db.prepare;
  const failure = new Error("injected settings write failure after DDL");
  try {
    db.prepare = ((sql: string) => {
      if (sql.includes("INSERT INTO settings")) throw failure;
      return originalPrepare.call(db, sql);
    }) as typeof db.prepare;
    assert.throws(() => initializeMemory(db, namespace, space), error => error === failure);
    db.prepare = originalPrepare;
    assert.equal(db.inTransaction, false);
    assert.equal(db.pragma("user_version", { simple: true }), 0n);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").all(), []);
    initializeMemory(db, namespace, space);
    assert.equal(db.pragma("user_version", { simple: true }), 1n);
    assert.equal(db.prepare<[], { n: bigint }>("SELECT count(*) AS n FROM settings").get()?.n, 5n);
  } finally {
    db.prepare = originalPrepare;
    db.close();
  }
});

test("closed-writer checkpoint backup restores newly committed records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "one-mem backup restore "));
  const path = join(directory, "source.sqlite");
  const backup = join(directory, "backup.sqlite");
  const restored = join(directory, "restored.sqlite");
  try {
    createVersionOne(path);
    const memory = await openMemory({ path, namespace, embeddings: provider() });
    let revision: string;
    try {
      const result = await memory.upsert([{ id: "new", sourceId: "backup", text: "newly committed" }]);
      revision = result.records[0]!.revision;
    } finally {
      await memory.close();
    }
    const db = openStorage(path);
    try {
      assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
      const checkpoint = db.pragma("wal_checkpoint(TRUNCATE)") as { busy: bigint }[];
      assert.equal(checkpoint[0]?.busy, 0n);
    } finally {
      db.close();
    }
    copyFileSync(path, backup);
    copyFileSync(backup, restored);
    const copy = await openMemory({ path: restored, namespace, embeddings: provider() });
    try {
      assert.deepEqual(await copy.get("new"), { id: "new", sourceId: "backup", text: "newly committed", revision });
      assert.equal((await copy.get("old-b"))?.text, originals[1]!.text);
      assert.equal((await copy.search("ZX-81", { limit: 1 })).items[0]?.record.id, "old-a");
    } finally {
      await copy.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a new embedding space rebuilds into a separate database from authoritative records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "one-mem model rebuild "));
  const path = join(directory, "original.sqlite");
  const newPath = join(directory, "new-model.sqlite");
  try {
    createVersionOne(path);
    const embeddings: EmbeddingProvider = {
      space: { id: "fixture-space-v2", dimensions: 3, metric: "cosine" },
      async embed(texts) { return texts.map(() => new Float32Array([0, 0, 1])); },
    };
    await assert.rejects(openMemory({ path, namespace, embeddings }), { code: "EMBEDDING_MISMATCH" });
    const rebuilt = await openMemory({ path: newPath, namespace, embeddings });
    try {
      await rebuilt.upsert(originals);
      for (const [index, original] of originals.entries()) {
        const value = await rebuilt.get(original.id);
        assert.notEqual(value?.revision, revisions[index]);
        assert.deepEqual(value && { ...value, revision: undefined }, { ...original, revision: undefined });
      }
      assert.equal((await rebuilt.search("ZX-81", { limit: 1 })).embeddingSpace.id, "fixture-space-v2");
    } finally {
      await rebuilt.close();
    }
    const source = await openMemory({ path, namespace, embeddings: provider() });
    try {
      assert.equal((await source.get("old-a"))?.revision, revisions[0]);
    } finally {
      await source.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
