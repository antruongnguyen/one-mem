import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openMemory, MemoryError } from "../dist/index.js";
import type { EmbeddingProvider, SearchOptions } from "../dist/index.js";
import { openStorage } from "../dist/storage.js";

function provider(): EmbeddingProvider & { queries: string[] } {
  return {
    space: { id: "search-contract-v1", dimensions: 2, metric: "cosine" },
    queries: [],
    async embed(texts, options) {
      if (options.purpose === "query") this.queries.push(...texts);
      return texts.map(() => new Float32Array([1, 0]));
    },
  };
}
const input = { id: "a", sourceId: "source", text: "needle" };

test("search rejects invalid queries and unsupported options before inference", async () => {
  const embeddings = provider();
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings });
  try {
    await memory.upsert([input]);
    for (const query of [null, 42, "", " \n", "\ud800"]) {
      await assert.rejects(memory.search(query as string), { code: "INVALID_INPUT" });
    }
    const invalidOptions = [
      null, [], { neighbors: -1 }, { unknown: true }, { signal: {} },
      { sessionId: "session" }, { sourceId: " " }, { sourceId: "source", sessionId: "" },
      { sourceId: "\udfff" }, { sourceId: "source", sessionId: 1 },
      ...[0, -1, 0.5, 101, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(limit => ({ limit })),
      ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(maxEvidenceBytes => ({ maxEvidenceBytes })),
    ];
    for (const options of invalidOptions) {
      await assert.rejects(memory.search("needle", options as SearchOptions), { code: "INVALID_INPUT" });
    }
    assert.equal(embeddings.queries.length, 0);
  } finally {
    await memory.close();
  }
});

test("search defaults limit results without counting limit exclusions as byte omissions", async () => {
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings: provider() });
  try {
    await memory.upsert(Array.from({ length: 20 }, (_, i) => ({ ...input, id: String(i).padStart(2, "0") })));
    const result = await memory.search("needle");
    assert.equal(result.items.length, 10);
    assert.equal(result.diagnostics.usedBytes, 60);
    assert.equal(result.diagnostics.budgetOmitted, 0);
    assert.equal(result.diagnostics.denseCandidates, 20);
    assert.equal(result.diagnostics.lexicalCandidates, 20);
    assert.ok(result.items.every(item => item.role === "match" && Number.isFinite(item.score)));
    assert.deepEqual(result.items[0]!.anchorIds, []);
  } finally {
    await memory.close();
  }
});

test("an empty effective scope skips inference but still validates cancellation and space", async () => {
  const embeddings = provider();
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings });
  try {
    await memory.upsert([input]);
    const result = await memory.search(" Needle ", { sourceId: "absent" });
    assert.deepEqual(result.items, []);
    assert.equal(result.namespace, "test");
    assert.equal(result.query, " Needle ");
    assert.equal(result.diagnostics.lexicalTermsUsed, 1);
    assert.equal(result.diagnostics.denseCandidates, 0);
    assert.equal(embeddings.queries.length, 0);
    const reason = Object.assign(new Error("caller cancellation"), { code: "SQLITE_BUSY" });
    const signal = AbortSignal.abort(reason);
    await assert.rejects(memory.search("needle", { sourceId: "absent", signal }), error => error === reason);
    embeddings.space.id = "changed";
    await assert.rejects(memory.search("needle", { sourceId: "absent" }), { code: "EMBEDDING_MISMATCH" });
    assert.equal(embeddings.queries.length, 0);
  } finally {
    await memory.close();
  }
});

test("query purpose and diagnostics preserve original text with distinct lowercase token limits", async () => {
  const embeddings = provider();
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings });
  try {
    await memory.upsert([input]);
    const query = ` ${Array.from({ length: 32 }, (_, i) => `word${i}`).join(" ")} WORD0 `;
    const first = await memory.search(query);
    assert.equal(first.query, query);
    assert.equal(first.diagnostics.lexicalTermsUsed, 32);
    assert.equal(first.diagnostics.lexicalTermsTruncated, false);
    const second = await memory.search(`${query} word32`);
    assert.equal(second.diagnostics.lexicalTermsUsed, 32);
    assert.equal(second.diagnostics.lexicalTermsTruncated, true);
    assert.deepEqual(embeddings.queries, [query, `${query} word32`]);
  } finally {
    await memory.close();
  }
});

test("public hybrid tie order matches SQLite binary UTF-8 order", async () => {
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings: provider() });
  try {
    await memory.upsert([{ ...input, id: "\u{10000}" }, { ...input, id: "\uE000" }]);
    const result = await memory.search("needle");
    assert.deepEqual(result.items.map(item => item.record.id), ["\uE000", "\u{10000}"]);
    assert.deepEqual(result.items.map(item => item.ranks), [{ dense: 1, lexical: 1 }, { dense: 2, lexical: 2 }]);
  } finally {
    await memory.close();
  }
});

test("query failure never falls back to lexical results or poisons later operations", async () => {
  const embeddings = provider();
  const normalEmbed = embeddings.embed;
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings });
  try {
    await memory.upsert([input]);
    const cause = new MemoryError("CLOSED", "provider exception");
    embeddings.embed = async () => { throw cause; };
    await assert.rejects(memory.search("needle"), error => error instanceof MemoryError && error.code === "PROVIDER_FAILURE" && error.cause === cause);
    embeddings.embed = normalEmbed;
    assert.equal((await memory.search("needle")).items[0]?.record.id, "a");
  } finally {
    await memory.close();
  }
});

test("query vectors use the same count dimension and finite-norm validation as documents", async () => {
  const embeddings = provider();
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings });
  try {
    await memory.upsert([input]);
    for (const output of [[], new Array<Float32Array>(1), [new Float32Array([1])], [new Float32Array([0, 0])],
      [new Float32Array([NaN, 1])], [new Float32Array([Infinity, 1])], [new Float32Array([1, 0]), new Float32Array([1, 0])]]) {
      embeddings.embed = async () => output;
      await assert.rejects(memory.search("needle"), { code: "EMBEDDING_MISMATCH" });
    }
  } finally {
    await memory.close();
  }
});

test("query cancellation and in-flight descriptor mutation reject before retrieval", async () => {
  const embeddings = provider();
  const memory = await openMemory({ path: ":memory:", namespace: "test", embeddings });
  try {
    await memory.upsert([input]);
    const controller = new AbortController();
    const reason = new Error("cancel during query");
    embeddings.embed = async () => {
      controller.abort(reason);
      return [new Float32Array([1, 0])];
    };
    await assert.rejects(memory.search("needle", { signal: controller.signal }), error => error === reason);
    embeddings.embed = async () => {
      embeddings.space.id = "other space";
      return [new Float32Array([1, 0])];
    };
    await assert.rejects(memory.search("needle"), { code: "EMBEDDING_MISMATCH" });
    assert.equal((await memory.get("a"))?.text, "needle");
  } finally {
    await memory.close();
  }
});

test("retrieval sees writes during query inference and returns detached evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "one-mem search snapshot "));
  const path = join(directory, "memory.sqlite");
  const embeddings = provider();
  const memory = await openMemory({ path, namespace: "test", embeddings });
  const other = await openMemory({ path, namespace: "test", embeddings: provider() });
  try {
    await memory.upsert([input]);
    const previous = await memory.get("a");
    const documentEmbed = embeddings.embed;
    embeddings.embed = async () => {
      await other.upsert([{ ...input, text: "needle replacement" }, { ...input, id: "b" }]);
      return [new Float32Array([1, 0])];
    };
    const result = await memory.search("needle");
    const a = result.items.find(item => item.record.id === "a")!;
    assert.equal(a.record.text, "needle replacement");
    assert.notEqual(a.record.revision, previous?.revision);
    assert.ok(result.items.some(item => item.record.id === "b"));
    await other.remove(["a", "b"]);
    assert.equal(a.record.text, "needle replacement");
    assert.equal(result.items.length, 2);
    if (!Object.isFrozen(result.embeddingSpace)) result.embeddingSpace.id = "consumer mutation";
    embeddings.embed = documentEmbed;
    await memory.upsert([input]);
    assert.equal((await memory.get("a"))?.text, "needle");
  } finally {
    await other.close();
    await memory.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("corrupt stored vectors cannot become leading null-distance results", async () => {
  const directory = mkdtempSync(join(tmpdir(), "one-mem corrupt vector "));
  const path = join(directory, "memory.sqlite");
  const memory = await openMemory({ path, namespace: "test", embeddings: provider() });
  try {
    await memory.upsert([input]);
    const db = openStorage(path);
    try {
      const bytes = Buffer.alloc(8);
      bytes.writeFloatLE(NaN, 0);
      bytes.writeFloatLE(1, 4);
      db.prepare("UPDATE records SET embedding = ? WHERE id = ?").run(bytes, "a");
    } finally {
      db.close();
    }
    await assert.rejects(memory.search("needle"), { code: "DATABASE_MISMATCH" });
  } finally {
    await memory.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
