import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { cpus, release, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { openStorage } from "../dist/storage.js";
import { createFixtureSchema } from "../.test-dist/fixtures.js";

// File-backed evidence only: no public retrieval API or production latency claim.
const dimensions = 384;
const budgetMs = 100;
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1];
const summary = values => ({ p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95) });
function vectorGenerator(seed) {
  return () => {
    const values = new Float32Array(dimensions);
    let squaredNorm = 0;
    for (let i = 0; i < dimensions; i++) {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      values[i] = seed / 4294967296 - 0.5;
      squaredNorm += values[i] ** 2;
    }
    const bytes = Buffer.alloc(dimensions * 4);
    for (let i = 0; i < dimensions; i++) {
      values[i] /= Math.sqrt(squaredNorm);
      assert.ok(Number.isFinite(values[i]));
      bytes.writeFloatLE(values[i], i * 4);
    }
    return bytes;
  };
}
const queryVector = vectorGenerator(987654321);
const queries = [queryVector(), queryVector(), queryVector()];
const queryHash = createHash("sha256").update(Buffer.concat(queries)).digest("hex");
assert.equal(queryHash, "5a1c9573e19e6a21818a0e075380182befe58bcd8a08ece1e7e5012f4f0bd600");
const expectedHashes = {
  10000: "9737bcc89593e39679bcbd2a543770322d1db980d751e4f45d42879dee84f945",
  100000: "fc4fac7c243d914b09a68aead03c312d8c4c9c9f59adfc1781d2f84c647c02bc",
};
const packageVersion = name => JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8")).version;
const report = {
  timestamp: new Date().toISOString(),
  environment: {
    runtime: process.versions.bun ? "Bun" : "Node.js",
    versions: process.versions, platform: process.platform, arch: process.arch,
    osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(), betterSqlite3: packageVersion("better-sqlite3"),
    sqliteVec: packageVersion("sqlite-vec"),
  },
  method: {
    dimensions, limit: 10, branchCandidates: 50, rrfConstant: 60,
    queryHash, warmupsPerQuery: 2, samplesPerQuery: 30,
    provisionalWarmHybridP95BudgetMs: budgetMs,
    cache: "Fresh local file per size; reopen after insertion; warm OS cache; prepared statements; no cache eviction",
    timing: "One insert batch per size and one 1000-row update batch include FTS maintenance and commit; vector generation excluded. Hybrid includes both branches, fusion and ten text rows in one read transaction.",
    text: "common record ID; needle on IDs divisible by 10, ordinary otherwise; source=id%2, session=id%100",
    order: "10k then 100k; none/50%/1%; three queries, one untimed reference call and two warmups then 30 samples each; nearest-rank percentiles",
  },
  sizes: [],
};

for (const size of [10000, 100000]) {
  const directory = mkdtempSync(join(tmpdir(), "one-mem benchmark dữ liệu "));
  const path = join(directory, "memory.sqlite");
  let db;
  try {
    db = openStorage(path);
    createFixtureSchema(db);
    report.environment.sqlite = db.prepare("SELECT sqlite_version() AS v").get().v;
    report.environment.extension = db.prepare("SELECT vec_version() AS v").get().v;
    const result = { size, journalMode: db.pragma("journal_mode", { simple: true }), synchronous: String(db.pragma("synchronous", { simple: true })), cases: [] };
    const nextVector = vectorGenerator(123456789);
    const datasetHash = createHash("sha256");
    const vectors = Array.from({ length: size }, (_, index) => {
      const id = index + 1;
      const bytes = nextVector();
      datasetHash.update(`${id}:${id % 2}:${id % 100}:`).update(bytes);
      return bytes;
    });
    result.datasetHash = datasetHash.digest("hex");
    assert.equal(result.datasetHash, expectedHashes[size]);
    const insert = db.prepare("INSERT INTO fixture_records (id, source_id, session_id, text, embedding) VALUES (?, ?, ?, ?, ?)");
    let started = performance.now();
    db.transaction(() => {
      for (let id = 1; id <= size; id++) {
        insert.run(String(id).padStart(6, "0"), String(id % 2), String(id % 100), `common record ${id} ${id % 10 === 0 ? "needle" : "ordinary"}`, vectors[id - 1]);
      }
    })();
    result.insertMs = performance.now() - started;
    db.close();
    db = openStorage(path);

    for (const [filter, predicate, parameters, fraction] of [
      ["none", "1", [], 1],
      ["50%", "r.source_id = ?", ["0"], 2],
      ["1%", "r.source_id = ? AND r.session_id = ?", ["0", "0"], 100],
    ]) {
      const selected = Number(db.prepare(`SELECT count(*) AS n FROM fixture_records r WHERE ${predicate}`).get(...parameters).n);
      assert.equal(selected, size / fraction);
      const dense = db.prepare(`SELECT r.id, r.text, vec_distance_cosine(r.embedding, ?) AS distance FROM fixture_records r WHERE ${predicate} ORDER BY distance, r.id COLLATE BINARY LIMIT 50`);
      const lexical = db.prepare(`SELECT r.id, r.text FROM fixture_fts JOIN fixture_records r ON r.row_id = fixture_fts.rowid WHERE fixture_fts MATCH ? AND ${predicate} ORDER BY bm25(fixture_fts), r.id COLLATE BINARY LIMIT 50`);
      const search = db.transaction(query => {
        const scores = new Map();
        for (const rows of [dense.all(query, ...parameters), lexical.all("needle", ...parameters)]) {
          rows.forEach((row, index) => {
            const previous = scores.get(row.id);
            scores.set(row.id, { id: row.id, text: row.text, score: (previous?.score ?? 0) + 1 / (60 + index + 1) });
          });
        }
        return [...scores.values()].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 10);
      });
      const samples = [];
      const results = [];
      for (const query of queries) {
        const expected = search(query);
        for (let sample = 0; sample < 32; sample++) {
          started = performance.now();
          const rows = search(query);
          const elapsed = performance.now() - started;
          assert.equal(rows.length, 10);
          assert.deepEqual(rows, expected);
          for (const row of rows) {
            assert.ok(Number.isFinite(row.score));
            if (fraction >= 2) assert.equal(Number(row.id) % 2, 0);
            if (fraction === 100) assert.equal(Number(row.id) % 100, 0);
          }
          if (sample >= 2) samples.push(elapsed);
        }
        results.push(expected);
      }
      const timings = summary(samples);
      result.cases.push({ filter, selected, sampleCount: samples.length, ...timings, withinProvisionalBudget: timings.p95Ms <= budgetMs, samplesMs: samples, results });
    }

    const update = db.prepare("UPDATE fixture_records SET text = ?, embedding = ? WHERE id = ?");
    const updateCount = Math.min(size, 1000);
    started = performance.now();
    db.transaction(() => {
      for (let id = 1; id <= updateCount; id++) update.run(`changed record ${id}`, queries[0], String(id).padStart(6, "0"));
    })();
    result.updateMs = performance.now() - started;
    result.updatedRecords = updateCount;
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
    result.checkpointedDatabaseBytes = statSync(path).size;
    result.closedWalBytes = statSync(`${path}-wal`, { throwIfNoEntry: false })?.size ?? 0;
    result.closedShmBytes = statSync(`${path}-shm`, { throwIfNoEntry: false })?.size ?? 0;
    db = openStorage(path);
    assert.equal(db.prepare("SELECT count(*) AS n FROM fixture_records").get().n, BigInt(size));
    assert.equal(db.prepare("SELECT count(*) AS n FROM fixture_fts WHERE fixture_fts MATCH 'changed'").get().n, BigInt(updateCount));
    assert.equal(db.prepare("SELECT count(*) AS n FROM fixture_fts WHERE fixture_fts MATCH 'common'").get().n, BigInt(size - updateCount));
    assert.equal(db.prepare("SELECT count(*) AS n FROM fixture_records WHERE id <= '001000' AND embedding = ?").get(queries[0]).n, BigInt(updateCount));
    report.sizes.push(result);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
console.log(JSON.stringify(report, null, 2));
