import { test } from "node:test";
import assert from "node:assert/strict";

const metricsPath = "../scripts/evaluation-metrics.mjs";
const { measureQuery, summarizeQueries, latencySummary } = await import(metricsPath);

const sample = (gold: string[] | null | undefined, overrides = {}) => ({
  gold, rankedIds: ["c", "a", "a", "d"], candidateIds: ["a", "c", "d"],
  primaryIds: ["c", "a"], evidenceIds: ["c", "a", "b"], k: 2, ...overrides,
});

test("evaluation metrics use distinct IDs, ranked k and actual budget evidence", () => {
  const metrics = measureQuery(sample(["a", "b", "a"]));
  assert.equal(metrics.recallAtK, 0.5);
  assert.equal(metrics.reciprocalRankAtK, 0.5);
  assert.equal(metrics.evidenceRecall, 1);
  assert.equal(metrics.completeSupport, 1);
  assert.deepEqual(metrics.candidateMissIds, ["b"]);
  assert.deepEqual(metrics.contextRecoveredIds, ["b"]);
  const lost = measureQuery(sample(["a", "b"], { evidenceIds: ["a", "c"] }));
  assert.equal(lost.evidenceRecall, 0.5);
  assert.equal(lost.completeSupport, 0);
  const absent = measureQuery(sample(["z"]));
  assert.equal(absent.recallAtK, 0);
  assert.equal(absent.reciprocalRankAtK, 0);
  assert.equal(absent.evidenceRecall, 0);
});

test("candidate misses, rank cutoff and byte losses remain distinct", () => {
  const metrics = measureQuery(sample(["a", "b", "d", "z"], {
    primaryIds: ["c"], evidenceIds: ["c", "d"],
  }));
  assert.deepEqual(metrics.candidateMissIds, ["b", "z"]);
  assert.deepEqual(metrics.rankCutoffIds, ["d"]);
  assert.deepEqual(metrics.budgetLostPrimaryIds, ["a"]);
  assert.deepEqual(metrics.contextRecoveredIds, ["d"]);
  assert.deepEqual(metrics.missingEvidenceIds, ["a", "b", "z"]);
});

test("explicit no-answer and unannotated queries do not inflate quality metrics", () => {
  const noAnswer = measureQuery(sample([], { evidenceIds: ["a", "a", "b"] }));
  assert.equal(noAnswer.annotation, "no-answer");
  assert.equal(noAnswer.recallAtK, null);
  assert.equal(noAnswer.completeSupport, null);
  assert.equal(noAnswer.noAnswerExposureRecords, 2);
  const rows = [measureQuery(sample(["a", "b"])), noAnswer,
    measureQuery(sample(null)), measureQuery(sample(undefined))];
  const summary = summarizeQueries(rows);
  assert.equal(summary.annotatedQueries, 1);
  assert.equal(summary.noAnswerQueries, 1);
  assert.equal(summary.unannotatedQueries, 2);
  assert.equal(summary.recallAtK, 0.5);
  assert.equal(summary.mrrAtK, 0.5);
  assert.equal(summary.evidenceRecall, 1);
  assert.equal(summary.completeSupportCoverage, 1);
  assert.equal(summary.noAnswerExposureRate, 1);
  assert.equal(summarizeQueries(rows.slice(1)).recallAtK, null);
});

const evaluationPath = "../scripts/evaluate.mjs";

test("offline modes share fixture and budgets and preserve production evidence", async () => {
  const { runEvaluation } = await import(evaluationPath);
  const report = await runEvaluation({ warmups: 0, repeats: 1 });
  assert.match(report.build.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(report.build.distSha256, /^[a-f0-9]{64}$/);
  assert.ok(report.build.sourceFiles.includes("src/storage.ts"));
  assert.ok(report.build.distFiles.includes("dist/index.js"));
  assert.equal(new Date(report.generatedAt).toISOString(), report.generatedAt);
  assert.equal(report.fixture.id, "one-mem-authored-synthetic");
  assert.equal(report.fixture.license, "MIT");
  assert.equal(report.config.candidateLimit, 50);
  assert.equal(report.config.limit, 2);
  assert.equal(report.config.maxEvidenceBytes, 180);
  assert.equal(report.samples.length, 19 * 4);
  assert.equal(report.provider.httpAttempts, 0);
  assert.equal(report.provider.query.inputs, 19);
  assert.equal(report.provider.query.calls, 1);
  assert.equal(report.provider.document.inputs, 33);
  assert.equal(report.provider.ner.calls, 0);
  assert.equal(report.provider.reranker.calls, 0);
  assert.equal(report.provider.reader.calls, 0);
  for (const row of report.samples) {
    assert.equal(row.localRetrieval.count, 1);
    assert.equal(row.counts.usedBytes, row.items.reduce((n: number, item: { text: string }) => n + Buffer.byteLength(item.text), 0));
    assert.ok(row.counts.usedBytes <= 180);
    assert.ok(row.counts.selectedPrimary <= 2);
    assert.equal(new Set(row.items.map((item: { id: string }) => item.id)).size, row.items.length);
    if (row.mode === "lexical-only") assert.equal(row.counts.denseCandidates, 0);
    if (row.mode === "dense-only") assert.equal(row.counts.lexicalCandidates, 0);
    if (row.mode !== "hybrid-neighbors") assert.equal(row.counts.expandedContext, 0);
    assert.deepEqual(row.exposures.scopeViolationIds, []);
    assert.deepEqual(row.exposures.neighborBoundaryViolationIds, []);
  }
  const causal = report.samples.find((row: { queryId: string; mode: string }) => row.queryId === "causal" && row.mode === "hybrid-neighbors");
  assert.deepEqual(causal.metrics.contextRecoveredIds, ["cause-2"]);
  const missing = report.samples.find((row: { queryId: string; mode: string }) => row.queryId === "missing-metadata" && row.mode === "hybrid-neighbors");
  assert.equal(missing.counts.expandedContext, 0);
  const oversized = report.samples.filter((row: { queryId: string }) => row.queryId === "oversized-boundary");
  assert.equal(oversized.length, 4);
  for (const row of oversized) {
    assert.deepEqual(row.traces.primaryTopKIds, ["oversized-note"]);
    assert.deepEqual(row.items, []);
    assert.equal(row.counts.budgetOmitted, 1);
    assert.equal(row.counts.usedBytes, 0);
    assert.deepEqual(row.metrics.budgetLostPrimaryIds, ["oversized-note"]);
    assert.equal(row.metrics.recallAtK, 1);
    assert.equal(row.metrics.evidenceRecall, 0);
    assert.equal(row.metrics.completeSupport, 0);
  }
});

test("MRR@k excludes support beyond k and retains its candidate rank diagnostic", () => {
  const metrics = measureQuery(sample(["d"]));
  assert.equal(metrics.recallAtK, 0);
  assert.equal(metrics.reciprocalRankAtK, 0);
  assert.equal(metrics.firstCandidateSupportRank, 3);
});

test("offline CLI reports identical IDs, scores and metrics under Node and Bun", async () => {
  const { execFileSync } = await import("node:child_process");
  const path = new URL("../scripts/evaluate.mjs", import.meta.url);
  const { fileURLToPath } = await import("node:url");
  const args = [fileURLToPath(path), "--warmups", "0", "--repeats", "1"];
  const node = JSON.parse(execFileSync("node", args, { encoding: "utf8", maxBuffer: 2_000_000 }));
  const bun = JSON.parse(execFileSync("bun", args, { encoding: "utf8", maxBuffer: 2_000_000 }));
  assert.equal(node.resultSha256, bun.resultSha256);
  assert.equal(node.build.sourceSha256, bun.build.sourceSha256);
  assert.equal(node.build.distSha256, bun.build.distSha256);
  assert.equal(node.fixture.sha256, bun.fixture.sha256);
  assert.deepEqual(node.embeddingSpace, bun.embeddingSpace);
  assert.deepEqual(node.provider, bun.provider);
  assert.equal(node.environment.runtime, "Node.js");
  assert.equal(bun.environment.runtime, "Bun");
});

test("internal traces do not leak through public search and preserve its ranking", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { openMemory } = await import("../dist/index.js");
  const { openStorage, searchStoredRecords } = await import("../dist/storage.js");
  const { compileLexicalQuery } = await import("../dist/retrieval.js");
  const directory = mkdtempSync(join(tmpdir(), "one-mem-evaluation-parity-"));
  const path = join(directory, "memory.sqlite");
  const records = [
    { id: "a", sourceId: "s", sessionId: "q", sequence: 0, text: "rare identifier ZX_9" },
    { id: "b", sourceId: "s", sessionId: "q", sequence: 1, text: "neighbor causal support" },
    { id: "c", sourceId: "other", text: "rare identifier ZX_9" },
  ];
  const provider = { space: { id: "evaluation-parity", dimensions: 2, metric: "cosine" as const },
    async embed(texts: readonly string[]) { return texts.map(() => new Float32Array([1, 0])); } };
  const memory = await openMemory({ path, namespace: "parity", embeddings: provider });
  let db;
  try {
    await memory.upsert(records);
    db = openStorage(path);
    const vector = Buffer.alloc(8);
    vector.writeFloatLE(1, 0);
    const query = "rare identifier ZX_9";
    const scope = { sourceId: "s", sessionId: "q" };
    const evidence = await memory.search(query, { ...scope, limit: 1, neighbors: 1, maxEvidenceBytes: 100 });
    const internal = searchStoredRecords(db, vector, compileLexicalQuery(query).match, scope, 50, 1, 100, 1);
    assert.deepEqual(internal.items, evidence.items);
    assert.deepEqual(internal.selectedMatchIds, ["a"]);
    assert.deepEqual(internal.returnedContextIds, ["b"]);
    assert.deepEqual(Object.keys(evidence).sort(), ["diagnostics", "embeddingSpace", "items", "namespace", "query"]);
    assert.deepEqual(Object.keys(evidence.diagnostics).sort(), ["budgetOmitted", "denseCandidates", "lexicalCandidates", "lexicalTermsTruncated", "lexicalTermsUsed", "usedBytes"]);
    // Null dense input is a true lexical-only path, independent of vector availability.
    db.prepare("UPDATE records SET embedding = ? WHERE id = ?").run(Buffer.alloc(12), "a");
    const lexical = searchStoredRecords(db, null, compileLexicalQuery(query).match, scope, 50, 1, 100);
    assert.equal(lexical.denseCandidates, 0);
    assert.deepEqual(lexical.selectedMatchIds, ["a"]);
  } finally {
    await memory.close();
    if (db) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});


test("latency summaries retain samples and use declared nearest-rank percentiles", () => {
  assert.deepEqual(latencySummary([4, 1, 2, 3]), {
    samplesMs: [4, 1, 2, 3], count: 4, meanMs: 2.5, p50Ms: 2, p95Ms: 4,
  });
  assert.deepEqual(latencySummary([]), {
    samplesMs: [], count: 0, meanMs: null, p50Ms: null, p95Ms: null,
  });
});


test("exported trees without .git report unavailable metadata", async () => {
  const { readGitMetadata } = await import(evaluationPath);
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "one-mem-evaluation-no-git-"));
  try {
    assert.deepEqual(readGitMetadata(directory), { commit: null, dirty: null, gitAvailable: false });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
