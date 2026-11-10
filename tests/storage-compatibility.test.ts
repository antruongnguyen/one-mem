import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type Database from "better-sqlite3";
import { openStorage } from "../dist/storage.js";
import { createFixtureSchema, denseRows, insertFixture, lexicalIds,
  vectorBytes } from "./fixtures.js";

test("opens a Unicode file path, loads sqlite-vec and indexes FTS5", () => {
  const directory = mkdtempSync(join(tmpdir(), "one mem tiếng Việt "));
  let db;
  try {
    db = openStorage(join(directory, "memory dữ liệu.sqlite"));
    assert.equal(db.prepare("SELECT vec_version()").pluck().get(), "v0.1.9");
    createFixtureSchema(db);
    insertFixture(db, { id: "hello", sourceId: "source", text: "durable evidence",
      vector: [1, 0] });
    assert.deepEqual(lexicalIds(db, "evidence"), ["hello"]);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function withFixture(check: (db: Database.Database) => void): void {
  const db = openStorage(":memory:");
  try {
    createFixtureSchema(db);
    check(db);
  } finally {
    db.close();
  }
}

test("enables foreign keys and busy timeout without creating a library schema", () => {
  const db = openStorage(":memory:");
  try {
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1n);
    assert.equal(db.pragma("busy_timeout", { simple: true }), 5000n);
    assert.equal(db.pragma("journal_mode", { simple: true }), "memory");
    assert.equal(db.pragma("user_version", { simple: true }), 0n);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema").all(), []);
    db.exec(`CREATE TABLE parent(id INTEGER PRIMARY KEY);
      CREATE TABLE child(parent_id INTEGER REFERENCES parent(id));`);
    assert.throws(() => db.prepare("INSERT INTO child VALUES (?)").run(1n),
      { code: "SQLITE_CONSTRAINT_FOREIGNKEY" });
  } finally {
    db.close();
  }
});

test("FTS triggers replace old terms and remove deleted evidence", () => withFixture(db => {
  insertFixture(db, { id: "a", sourceId: "source", text: "ancient cobalt",
    vector: [1, 0] });
  assert.deepEqual(lexicalIds(db, "ancient"), ["a"]);
  db.prepare("UPDATE fixture_records SET text = ?, embedding = ? WHERE id = ?")
    .run("modern amber", vectorBytes([0, 1]), "a");
  assert.deepEqual(lexicalIds(db, "ancient OR cobalt"), []);
  assert.deepEqual(lexicalIds(db, "modern"), ["a"]);
  assert.equal(denseRows(db, [1, 0])[0]?.distance, 1);
  db.prepare("DELETE FROM fixture_records WHERE id = ?").run("a");
  assert.deepEqual(lexicalIds(db, "modern OR amber"), []);
  assert.deepEqual(denseRows(db, [1, 0]), []);
}));

test("cosine distances are zero, one and two for hand-checked vectors", () => withFixture(db => {
  for (const [id, vector] of [
    ["parallel", [1, 0]], ["orthogonal", [0, 1]], ["opposite", [-1, 0]],
  ] as const) {
    insertFixture(db, { id, sourceId: "source", text: id, vector });
  }
  const rows = denseRows(db, [1, 0]);
  assert.deepEqual(rows.map(row => row.id), ["parallel", "orthogonal", "opposite"]);
  rows.forEach((row, index) => assert.ok(Math.abs(row.distance - index) < 1e-6));
}));

test("scalar cosine executes at the proposed 8192-component library bound", () => withFixture(db => {
  const vector = new Array<number>(8192).fill(0);
  vector[8191] = 1;
  insertFixture(db, { id: "wide", sourceId: "source", text: "wide vector", vector });
  assert.deepEqual(denseRows(db, vector), [{ id: "wide", distance: 0 }]);
}));

test("source and session constraints apply before top-k with bound parameters", () => withFixture(db => {
  const sourceId = "source ' OR 1=1 -- tiếng Việt";
  const sessionId = "session ? ' --";
  insertFixture(db, { id: "other-source", sourceId: "elsewhere", sessionId,
    text: "outside", vector: [1, 0] });
  insertFixture(db, { id: "other-session", sourceId, sessionId: "different",
    text: "outside", vector: [1, 0] });
  insertFixture(db, { id: "scoped", sourceId, sessionId,
    text: "in scope", vector: [0, 1] });
  assert.deepEqual(denseRows(db, [1, 0], { sourceId }, 1).map(row => row.id),
    ["other-session"]);
  assert.deepEqual(denseRows(db, [1, 0], { sourceId, sessionId }, 1).map(row => row.id),
    ["scoped"]);
  assert.deepEqual(denseRows(db, [1, 0], { sourceId: "missing ' OR 1=1 --" }, 1), []);
  assert.deepEqual(lexicalIds(db, '"in"'), ["scoped"]);
}));

test("SQLite integers above 2^53 retain exact row and FTS identities", () => withFixture(db => {
  const rowId = 9007199254740993n;
  const id = "quoted ' id ?";
  insertFixture(db, { rowId, id, sourceId: "source", text: "precision evidence",
    vector: [1, 0] });
  const row = db.prepare<[string], { row_id: bigint; id: string }>(
    "SELECT row_id, id FROM fixture_records WHERE id = ?").get(id);
  assert.deepEqual(row, { row_id: 9007199254740993n, id });
  assert.equal(db.prepare("SELECT rowid FROM fixture_fts WHERE fixture_fts MATCH ?")
    .pluck().get("precision"), 9007199254740993n);
  assert.deepEqual(lexicalIds(db, "precision"), [id]);
  db.prepare("DELETE FROM fixture_records WHERE row_id = ?").run(rowId);
  assert.deepEqual(lexicalIds(db, "precision"), []);
}));

for (const operation of ["insert", "update", "delete"] as const) {
  test(`failed ${operation} transaction rolls back records, vectors and FTS`, () => withFixture(db => {
    insertFixture(db, { id: "existing", sourceId: "source", text: "original cobalt",
      vector: [1, 0] });
    const failure = new Error("abort fixture transaction");
    const transaction = db.transaction(() => {
      if (operation === "insert") {
        insertFixture(db, { id: "new", sourceId: "source", text: "temporary amber",
          vector: [0, 1] });
      } else if (operation === "update") {
        db.prepare("UPDATE fixture_records SET text = ?, embedding = ? WHERE id = ?")
          .run("temporary amber", vectorBytes([0, 1]), "existing");
      } else {
        db.prepare("DELETE FROM fixture_records WHERE id = ?").run("existing");
      }
      throw failure;
    });
    assert.throws(transaction, error => error === failure);
    assert.deepEqual(lexicalIds(db, "original"), ["existing"]);
    assert.deepEqual(lexicalIds(db, "temporary OR amber"), []);
    assert.deepEqual(denseRows(db, [1, 0]), [{ id: "existing", distance: 0 }]);
    assert.equal(db.inTransaction, false);
  }));
}

test("file storage uses WAL and retains updates after closing and reopening", () => {
  const directory = mkdtempSync(join(tmpdir(), "one mem reopen "));
  const path = join(directory, "persistent.sqlite");
  let db;
  try {
    db = openStorage(path);
    assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
    createFixtureSchema(db);
    insertFixture(db, { id: "saved", sourceId: "source", text: "before",
      vector: [1, 0] });
    db.prepare("UPDATE fixture_records SET text = ?, embedding = ? WHERE id = ?")
      .run("after", vectorBytes([0, 1]), "saved");
    db.close();
    db = openStorage(path);
    assert.deepEqual(lexicalIds(db, "before"), []);
    assert.deepEqual(lexicalIds(db, "after"), ["saved"]);
    assert.deepEqual(denseRows(db, [1, 0]), [{ id: "saved", distance: 1 }]);
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1n);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the other runtime reopens this database and persists its own writes", () => {
  const directory = mkdtempSync(join(tmpdir(), "one mem trao đổi "));
  const path = join(directory, "runtime shared.sqlite");
  let db;
  try {
    db = openStorage(path);
    createFixtureSchema(db);
    insertFixture(db, { rowId: 9007199254740993n, id: "shared", sourceId: "source",
      text: "first cobalt", vector: [1, 0] });
    insertFixture(db, { id: "removed", sourceId: "source", text: "obsolete",
      vector: [-1, 0] });
    db.close();
    const otherRuntime = process.versions.bun ? "node" : "bun";
    const child = spawnSync(otherRuntime,
      [fileURLToPath(new URL("./runtime-write.js", import.meta.url)), path],
      { encoding: "utf8" });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stdout + child.stderr);
    db = openStorage(path);
    assert.deepEqual(lexicalIds(db, "first OR obsolete"), []);
    assert.deepEqual(lexicalIds(db, "second"), ["shared"]);
    assert.deepEqual(lexicalIds(db, "fresh"), ["added"]);
    assert.equal(db.prepare("SELECT row_id FROM fixture_records WHERE id = ?")
      .pluck().get("shared"), 9007199254740993n);
    assert.deepEqual(denseRows(db, [1, 0]), [
      { id: "added", distance: 0 }, { id: "shared", distance: 1 },
    ]);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("missing parents and invalid database paths retain underlying I/O errors", () => {
  const directory = mkdtempSync(join(tmpdir(), "one mem paths "));
  try {
    assert.throws(() => openStorage(join(directory, "absent", "memory.sqlite")),
      error => error instanceof TypeError && error.cause === undefined
        && /directory does not exist/.test(error.message));
    assert.throws(() => openStorage(directory), error => error instanceof Error
      && "code" in error && error.code === "SQLITE_CANTOPEN" && error.cause === undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const unavailable of ["missing native", "invalid native", "missing extension"] as const) {
  test(`${unavailable} binary throws an actionable error with cause`, () => {
    const directory = mkdtempSync(join(tmpdir(), "one mem incomplete install "));
    try {
      writeFileSync(join(directory, "package.json"), '{"type":"module"}');
      cpSync(fileURLToPath(new URL("../dist/storage.js", import.meta.url)),
        join(directory, "storage.js"));
      const modules = join(directory, "node_modules");
      mkdirSync(modules);
      const root = fileURLToPath(new URL("../node_modules/", import.meta.url));
      for (const name of ["better-sqlite3", "sqlite-vec"]) {
        mkdirSync(join(modules, name));
        cpSync(join(root, name, "package.json"), join(modules, name, "package.json"));
      }
      cpSync(join(root, "better-sqlite3", "lib"), join(modules, "better-sqlite3", "lib"),
        { recursive: true });
      cpSync(join(root, "sqlite-vec", "index.mjs"), join(modules, "sqlite-vec", "index.mjs"));
      cpSync(join(root, "sqlite-vec", "index.cjs"), join(modules, "sqlite-vec", "index.cjs"));
      if (unavailable === "missing extension") {
        cpSync(join(root, "better-sqlite3", "prebuilds"),
          join(modules, "better-sqlite3", "prebuilds"), { recursive: true });
      } else if (unavailable === "invalid native") {
        const prebuilds = join(modules, "better-sqlite3", "prebuilds");
        mkdirSync(prebuilds);
        writeFileSync(join(prebuilds, `${process.platform}-${process.arch}.node`),
          "invalid native binary");
      }
      const storageUrl = pathToFileURL(join(directory, "storage.js")).href;
      const path = join(directory, "must close.sqlite");
      const script = `
        import assert from 'node:assert/strict';
        import { rmSync } from 'node:fs';
        const { openStorage } = await import(${JSON.stringify(storageUrl)});
        assert.throws(() => openStorage(${JSON.stringify(path)}), error => {
          assert.ok(error instanceof Error);
          assert.ok(error.cause instanceof Error);
          assert.ok(error.cause.message.includes(${JSON.stringify(unavailable === "missing extension"
            ? `sqlite-vec-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`
            : ".node")}));
          assert.match(error.message, /${unavailable === "missing extension" ? "sqlite-vec" : "better-sqlite3"}/);
          assert.match(error.message, /${process.platform}-${process.arch}/);
          assert.match(error.message, /install/i);
          return true;
        });
        rmSync(${JSON.stringify(path)}, { force: true });
      `;
      const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script],
        { encoding: "utf8" });
      assert.ifError(child.error);
      assert.equal(child.status, 0, child.stdout + child.stderr);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
