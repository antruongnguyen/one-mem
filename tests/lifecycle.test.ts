import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { openMemory } from "../dist/index.js";
import { openStorage } from "../dist/storage.js";
import { deferred, temporaryMemory } from "./memory-fixtures.js";

const a = { id: "a", sourceId: "s", text: "red apple" };

for (const action of ["update", "delete", "insert"] as const) {
  test(`conflicting revision writes nothing after second handle ${action}`, async () => {
    const fixture = temporaryMemory();
    const entered = deferred<void>();
    const release = deferred<void>();
    let delay = false;
    try {
      const first = await fixture.open({ embeddings: { space: fixture.embeddings.space,
        async embed(texts, options) {
          if (delay) { entered.resolve(); await release.promise; }
          return fixture.embeddings.embed(texts, options);
        } } });
      const second = await fixture.open();
      if (action !== "insert") await first.upsert([a]);
      delay = true;
      const pending = first.upsert([{ ...a, text: "blue ocean" },
        { id: "batch-only", sourceId: "s", text: "green leaf" }]);
      await entered.promise;
      if (action === "delete") await second.remove(["a"]);
      else await second.upsert([{ ...a, text: "green leaf" }]);
      const authoritative = await second.get("a");
      release.resolve();
      await assert.rejects(pending, { code: "CONFLICT" });
      assert.deepEqual(await first.get("a"), authoritative);
      assert.equal(await first.get("batch-only"), undefined);
    } finally { release.resolve(); await fixture.cleanup(); }
  });
}

test("embedding awaits hold no SQLite write lock", async () => {
  const fixture = temporaryMemory();
  const entered = deferred<void>();
  const release = deferred<void>();
  try {
    const first = await fixture.open({ embeddings: { space: fixture.embeddings.space,
      async embed(texts, options) { entered.resolve(); await release.promise;
        return fixture.embeddings.embed(texts, options); } } });
    const second = await fixture.open();
    const pending = first.upsert([a]);
    await entered.promise;
    await second.upsert([{ ...a, id: "b", text: "green leaf" }]);
    release.resolve();
    await pending;
    assert.equal((await first.get("b"))?.text, "green leaf");
  } finally { release.resolve(); await fixture.cleanup(); }
});

test("close drains accepted operations and rejects new operations", async () => {
  const fixture = temporaryMemory();
  const entered = deferred<void>();
  const release = deferred<void>();
  try {
    const memory = await fixture.open({ embeddings: { space: fixture.embeddings.space,
      async embed(texts, options) { entered.resolve(); await release.promise;
        return fixture.embeddings.embed(texts, options); } } });
    const writing = memory.upsert([a]);
    const reading = memory.get("a");
    await entered.promise;
    let closed = false;
    const closing = memory.close().then(() => { closed = true; });
    await assert.rejects(memory.get("a"), { code: "CLOSED" });
    await assert.rejects(memory.upsert([a]), { code: "CLOSED" });
    await assert.rejects(memory.remove(["a"]), { code: "CLOSED" });
    assert.equal(closed, false);
    release.resolve();
    await writing;
    assert.equal((await reading)?.text, "red apple");
    await closing;
    await memory.close();
    assert.equal((await (await fixture.open()).get("a"))?.text, "red apple");
  } finally { release.resolve(); await fixture.cleanup(); }
});

test("closed handle rejects operations", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    await memory.close();
    await memory.close();
    await assert.rejects(memory.get("a"), { code: "CLOSED" });
    await assert.rejects(memory.upsert([]), { code: "CLOSED" });
    await assert.rejects(memory.remove([]), { code: "CLOSED" });
  } finally { await fixture.cleanup(); }
});

test("failed accepted operation does not poison the queue", async () => {
  const fixture = temporaryMemory();
  let calls = 0;
  try {
    const memory = await fixture.open({ embeddings: { space: fixture.embeddings.space,
      async embed(texts, options) {
        if (calls++ === 0) throw new Error("first request fails");
        return fixture.embeddings.embed(texts, options);
      } } });
    const failing = memory.upsert([a]);
    const next = memory.upsert([{ ...a, id: "b" }]);
    await assert.rejects(failing, { code: "PROVIDER_FAILURE" });
    await next;
    assert.equal(await memory.get("a"), undefined);
    assert.equal((await memory.get("b"))?.text, "red apple");
  } finally { await fixture.cleanup(); }
});

test("other runtime reopens writes and removes persisted records", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    await memory.upsert([a]);
    await memory.close();
    const runtime = process.versions.bun ? "node" : "bun";
    const result = spawnSync(runtime, [fileURLToPath(new URL("./memory-runtime-write.js", import.meta.url)),
      fixture.path], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const reopened = await fixture.open();
    assert.equal(await reopened.get("a"), undefined);
    assert.equal((await reopened.get("b"))?.text, "blue ocean");
    assert.equal((await reopened.get("b"))?.sourceId, "other-runtime");
  } finally { await fixture.cleanup(); }
});

test("namespace and embedding space mismatches are rejected", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    await memory.upsert([a]);
    await memory.close();
    await assert.rejects(fixture.open({ namespace: "wrong" }), { code: "DATABASE_MISMATCH" });
    for (const space of [{ ...fixture.embeddings.space, id: "different-model" },
      { ...fixture.embeddings.space, dimensions: 3 }]) {
      await assert.rejects(fixture.open({ embeddings: { ...fixture.embeddings, space } }),
        { code: "EMBEDDING_MISMATCH" });
    }
    assert.equal((await (await fixture.open()).get("a"))?.text, "red apple");
  } finally { await fixture.cleanup(); }
});

test("newer schema is rejected without changing database bytes or journal mode", async () => {
  const fixture = temporaryMemory();
  try {
    const db = openStorage(fixture.path);
    db.pragma("journal_mode = DELETE");
    db.exec("CREATE TABLE future_data (text TEXT); INSERT INTO future_data VALUES ('keep me'); PRAGMA user_version = 2");
    db.close();
    const before = readFileSync(fixture.path);
    await assert.rejects(fixture.open(), { code: "UNSUPPORTED_SCHEMA" });
    assert.deepEqual(readFileSync(fixture.path), before);
  } finally { await fixture.cleanup(); }
});

test("foreign unversioned database is rejected without partial migration", async () => {
  const fixture = temporaryMemory();
  try {
    const db = openStorage(fixture.path);
    db.pragma("journal_mode = DELETE");
    db.exec("CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES ('keep me')");
    db.close();
    const before = readFileSync(fixture.path);
    await assert.rejects(fixture.open(), { code: "DATABASE_MISMATCH" });
    assert.deepEqual(readFileSync(fixture.path), before);
    const check = openStorage(fixture.path);
    try {
      assert.deepEqual(check.prepare("SELECT value FROM unrelated").all(), [{ value: "keep me" }]);
      assert.equal(check.pragma("user_version", { simple: true }), 0n);
      assert.equal(check.prepare("SELECT name FROM sqlite_schema WHERE name = 'records'").get(), undefined);
    } finally { check.close(); }
  } finally { await fixture.cleanup(); }
});

test("missing parent path retains an actionable filesystem error", async () => {
  const fixture = temporaryMemory();
  try {
    await assert.rejects(openMemory({ path: join(fixture.directory, "missing", "memory.sqlite"),
      namespace: "fixture", embeddings: fixture.embeddings }), /open|directory|exist/i);
  } finally { await fixture.cleanup(); }
});

test("malformed stored embedding settings are database mismatches", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    await memory.close();
    const db = openStorage(fixture.path);
    try { db.prepare("UPDATE settings SET value = ? WHERE key = 'embedding_dimensions'").run("not a dimension"); }
    finally { db.close(); }
    await assert.rejects(fixture.open(), { code: "DATABASE_MISMATCH" });
  } finally { await fixture.cleanup(); }
});

test("foreign schema names resembling SQLite internals are rejected", async () => {
  const fixture = temporaryMemory();
  try {
    const db = openStorage(fixture.path);
    db.pragma("journal_mode = DELETE");
    db.exec("CREATE TABLE sqlitex_payload (value TEXT); INSERT INTO sqlitex_payload VALUES ('keep me')");
    db.close();
    const before = readFileSync(fixture.path);
    await assert.rejects(fixture.open(), { code: "DATABASE_MISMATCH" });
    assert.deepEqual(readFileSync(fixture.path), before);
  } finally { await fixture.cleanup(); }
});

test("embedding dimension boundaries and descriptor mutations are enforced", async () => {
  const fixture = temporaryMemory();
  try {
    for (const dimensions of [1, 8192]) {
      const memory = await fixture.open({ path: ":memory:", embeddings: {
        space: { id: `dimensions-${dimensions}`, dimensions, metric: "cosine" },
        async embed(texts) { return texts.map(() => { const vector = new Float32Array(dimensions); vector[0] = 1; return vector; }); },
      } });
      await memory.upsert([a]);
      assert.equal((await memory.get("a"))?.text, "red apple");
    }
    for (const dimensions of [0, 8193, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(fixture.open({ path: ":memory:", embeddings: {
        ...fixture.embeddings, space: { ...fixture.embeddings.space, dimensions },
      } }), { code: "INVALID_INPUT" });
    }
    const memory = await fixture.open();
    fixture.embeddings.space.id = "mutated-id";
    await assert.rejects(memory.upsert([a]), { code: "EMBEDDING_MISMATCH" });
    assert.equal(fixture.embeddings.inputs.length, 0);
    assert.equal(await memory.get("a"), undefined);
  } finally { await fixture.cleanup(); }
});

test("unchanged affected records are rechecked after another handle writes", async () => {
  const fixture = temporaryMemory();
  const entered = deferred<void>();
  const release = deferred<void>();
  let delay = false;
  try {
    const first = await fixture.open({ embeddings: { space: fixture.embeddings.space,
      async embed(texts, options) { if (delay) { entered.resolve(); await release.promise; }
        return fixture.embeddings.embed(texts, options); } } });
    const second = await fixture.open();
    await first.upsert([a]);
    delay = true;
    const pending = first.upsert([a, { ...a, id: "b", text: "blue ocean" }]);
    await entered.promise;
    await second.upsert([{ ...a, speaker: "changed externally" }]);
    release.resolve();
    await assert.rejects(pending, { code: "CONFLICT" });
    assert.equal(await first.get("b"), undefined);
    assert.equal((await first.get("a"))?.speaker, "changed externally");
  } finally { release.resolve(); await fixture.cleanup(); }
});

test("database operation errors remain errors instead of missing records", async () => {
  const fixture = temporaryMemory();
  try {
    const memory = await fixture.open();
    const db = openStorage(fixture.path);
    try { db.exec("DROP TABLE records"); } finally { db.close(); }
    await assert.rejects(memory.get("a"), error => {
      assert.ok(error instanceof Error && "code" in error);
      assert.equal(error.code, "SQLITE_ERROR");
      assert.match(error.message, /no such table/);
      return true;
    });
  } finally { await fixture.cleanup(); }
});

test("malformed Unicode open options cannot create a differently encoded database", async () => {
  const fixture = temporaryMemory();
  try {
    await assert.rejects(fixture.open({ namespace: "namespace\ud800" }), { code: "INVALID_INPUT" });
    await assert.rejects(fixture.open({ path: `${fixture.directory}/bad\udfff.sqlite` }), { code: "INVALID_INPUT" });
    await assert.rejects(fixture.open({ embeddings: {
      ...fixture.embeddings, space: { ...fixture.embeddings.space, id: "space\ud800" },
    } }), { code: "INVALID_INPUT" });
  } finally { await fixture.cleanup(); }
});
