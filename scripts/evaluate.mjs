import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { openMemory } from "../dist/index.js";
import { embedTexts } from "../dist/embeddings.js";
import { compileLexicalQuery } from "../dist/retrieval.js";
import { openStorage, searchStoredRecords } from "../dist/storage.js";
import { latencySummary, measureQuery, summarizeQueries } from "./evaluation-metrics.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const modes = ["dense-only", "lexical-only", "hybrid", "hybrid-neighbors"];
const checksum = value => createHash("sha256").update(value).digest("hex");
const intersect = (ids, marked = []) => ids.filter(id => marked.includes(id));

export function readGitMetadata(directory) {
  if (!existsSync(join(directory, ".git"))) return { commit: null, dirty: null, gitAvailable: false };
  try {
    const git = args => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return { commit: git(["rev-parse", "HEAD"]), dirty: git(["status", "--porcelain"]).length > 0, gitAvailable: true };
  } catch {
    return { commit: null, dirty: null, gitAvailable: false };
  }
}

function listFiles(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? listFiles(path) : entry.isFile() ? [path] : [];
  });
}

function hashFiles(files) {
  const hash = createHash("sha256");
  for (const path of files) {
    const bytes = readFileSync(join(root, path));
    hash.update(`${path}\0${bytes.length}\0`, "utf8");
    hash.update(bytes);
  }
  return hash.digest("hex");
}

export async function runEvaluation({ warmups = 2, repeats = 5 } = {}) {
  assert.ok(Number.isSafeInteger(warmups) && warmups >= 0, "warmups must be a nonnegative integer");
  assert.ok(Number.isSafeInteger(repeats) && repeats >= 1, "repeats must be a positive integer");
  const bytes = readFileSync(join(root, "tests/fixtures/evaluation.json"));
  const fixture = JSON.parse(bytes);
  const { records, queries } = fixture.inputs;
  const counters = { document: { calls: 0, inputs: 0, inputUtf8Bytes: 0, samplesMs: [] },
    query: { calls: 0, inputs: 0, inputUtf8Bytes: 0, samplesMs: [] } };
  // This provider receives only text/purpose, with manually declared vectors and no gold labels.
  const vectors = Object.fromEntries(["document", "query"].map(purpose => [purpose,
    new Map((purpose === "document" ? records : queries).map((input, i) => [input.text, fixture.embeddings[purpose][i]]))]));
  const provider = {
    space: fixture.embeddingSpace,
    async embed(texts, { purpose }) {
      const start = performance.now();
      const count = counters[purpose];
      count.calls++;
      count.inputs += texts.length;
      count.inputUtf8Bytes += texts.reduce((sum, text) => sum + Buffer.byteLength(text, "utf8"), 0);
      const result = texts.map(text => {
        assert.ok(vectors[purpose].has(text), "synthetic provider input must have a declared vector");
        return new Float32Array(vectors[purpose].get(text));
      });
      count.samplesMs.push(performance.now() - start);
      return result;
    },
  };
  const directory = mkdtempSync(join(tmpdir(), "one-mem-evaluation-"));
  let memory;
  let db;
  try {
    const path = join(directory, "memory.sqlite");
    memory = await openMemory({ path, namespace: fixture.namespace, embeddings: provider });
    const ingestionStart = performance.now();
    await memory.upsert(records);
    const ingestionMs = performance.now() - ingestionStart;
    await memory.close();
    db = openStorage(path);
    const queryStart = performance.now();
    // One batch, one vector per unique query, reused across all dense/hybrid modes and repeats.
    assert.equal(new Set(queries.map(query => query.text)).size, queries.length);
    const queryVectors = await embedTexts(provider, fixture.embeddingSpace, queries.map(query => query.text), "query");
    const queryEmbeddingMs = performance.now() - queryStart;
    const { candidateLimit, limit, maxEvidenceBytes, neighbors } = fixture.config;
    assert.equal(candidateLimit, Math.min(500, Math.max(50, 5 * limit)), "candidate budget must match production");
    const samples = [];
    for (const [index, query] of queries.entries()) {
      const lexical = compileLexicalQuery(query.text);
      const annotation = fixture.annotations[query.id] ?? {};
      for (const mode of modes) {
        const vector = mode === "lexical-only" ? null : queryVectors[index];
        const match = mode === "dense-only" ? null : lexical.match;
        const radius = mode === "hybrid-neighbors" ? neighbors : 0;
        const run = () => searchStoredRecords(db, vector, match, query.scope,
          candidateLimit, limit, maxEvidenceBytes, radius);
        for (let i = 0; i < warmups; i++) run();
        const timings = [];
        let result;
        for (let i = 0; i < repeats; i++) {
          const start = performance.now();
          result = run();
          timings.push(performance.now() - start);
        }
        const ids = result.items.map(item => item.record.id);
        const unionIds = [...new Set([...result.denseIds, ...result.lexicalIds])];
        const metrics = measureQuery({ gold: annotation.gold, candidateIds: unionIds,
          rankedIds: result.rankedIds, primaryIds: result.selectedMatchIds, evidenceIds: ids, k: limit });
        metrics.contextBudgetLostIds = Array.isArray(annotation.gold) ? [...new Set(annotation.gold)].filter(id =>
          result.neighborCandidateIds.includes(id) && !ids.includes(id)) : [];
        const scopeViolationIds = result.items.filter(({ record }) =>
          (query.scope.sourceId !== undefined && record.sourceId !== query.scope.sourceId)
          || (query.scope.sessionId !== undefined && record.sessionId !== query.scope.sessionId)).map(item => item.record.id);
        const byId = new Map(result.items.map(item => [item.record.id, item.record]));
        const neighborBoundaryViolationIds = result.items.filter(item => item.role === "context" &&
          item.anchorIds.some(anchorId => {
            const anchor = byId.get(anchorId);
            return !anchor || anchor.sourceId !== item.record.sourceId || anchor.sessionId !== item.record.sessionId
              || anchor.sequence === undefined || item.record.sequence === undefined
              || Math.abs(anchor.sequence - item.record.sequence) > radius;
          })).map(item => item.record.id);
        samples.push({ queryId: query.id, query: query.text, scope: query.scope, mode,
          slices: annotation.slices ?? [], metrics,
          traces: { denseIds: result.denseIds, lexicalIds: result.lexicalIds, unionIds,
            rankedIds: result.rankedIds, primaryTopKIds: result.primaryTopKIds,
            selectedMatchIds: result.selectedMatchIds, neighborCandidateIds: result.neighborCandidateIds,
            returnedContextIds: result.returnedContextIds },
          counts: { denseCandidates: result.denseCandidates, lexicalCandidates: result.lexicalCandidates,
            unionCandidates: unionIds.length, primaryTopK: result.primaryTopKIds.length,
            selectedPrimary: result.selectedMatchIds.length, neighborCandidates: result.neighborCandidateIds.length,
            expandedContext: result.returnedContextIds.length, uniqueRecords: ids.length,
            uniqueSources: new Set(result.items.map(item => item.record.sourceId)).size,
            usedBytes: result.usedBytes, budgetOmitted: result.budgetOmitted,
            lexicalTermsUsed: mode === "dense-only" ? 0 : lexical.termsUsed,
            lexicalTermsTruncated: mode === "dense-only" ? false : lexical.truncated },
          exposures: { scopeViolationIds, neighborBoundaryViolationIds,
            boundaryMarkedIds: intersect(ids, annotation.boundaryExposureIds),
            subjectMarkedIds: intersect(ids, annotation.subjectExposureIds),
            temporalMarkedIds: intersect(ids, annotation.temporalExposureIds) },
          items: result.items.map(item => ({ ...item.record, role: item.role, score: item.score,
            ranks: item.ranks, anchorIds: item.anchorIds })),
          localRetrieval: latencySummary(timings) });
      }
    }
    const summarize = rows => ({ ...summarizeQueries(rows.map(row => row.metrics)),
      exposureCounts: Object.fromEntries(["scopeViolationIds", "neighborBoundaryViolationIds", "boundaryMarkedIds", "subjectMarkedIds", "temporalMarkedIds"].map(field =>
        [field, rows.reduce((sum, row) => sum + row.exposures[field].length, 0)])),
      localRetrieval: latencySummary(rows.flatMap(row => row.localRetrieval.samplesMs)) });
    const byMode = Object.fromEntries(modes.map(mode => {
      const rows = samples.filter(row => row.mode === mode);
      const slices = [...new Set(rows.flatMap(row => row.slices))];
      return [mode, { aggregate: summarize(rows), slices: Object.fromEntries(slices.map(slice =>
        [slice, summarize(rows.filter(row => row.slices.includes(slice)))])) }];
    }));
    const stableSamples = samples.map(({ localRetrieval, items, ...row }) => ({ ...row,
      items: items.map(({ revision, ...item }) => item) }));
    const sourceFiles = [...listFiles("src"), "scripts/evaluate.mjs", "scripts/evaluation-metrics.mjs",
      "package.json", "bun.lock", "tsconfig.json", "tests/fixtures/evaluation.json"].sort();
    const distFiles = listFiles("dist").sort();
    const extension = db.prepare("SELECT sqlite_version() AS sqlite, vec_version() AS vec").get();
    return {
      reportVersion: 1, generatedAt: new Date().toISOString(), fixture: { id: fixture.id, version: fixture.version, license: fixture.license,
        sha256: checksum(bytes), authorship: fixture.authorship, purpose: fixture.purpose,
        records: records.length, queries: queries.length },
      build: { ...readGitMetadata(root), sourceSha256: hashFiles(sourceFiles), distSha256: hashFiles(distFiles),
        sourceFiles, distFiles,
        hashDefinition: "SHA-256 over lexically sorted forward-slash relative file paths: UTF-8 path + NUL + decimal byte length + NUL + exact file bytes, repeated for each listed file" },
      environment: { runtime: process.versions.bun ? "Bun" : "Node.js", runtimeVersion: process.versions.bun ?? process.versions.node,
        nodeCompatibilityVersion: process.versions.node, os: platform(), osRelease: release(), architecture: arch(),
        cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(),
        sqlite: extension.sqlite, sqliteVec: extension.vec,
        betterSqlite3: require("better-sqlite3/package.json").version,
        sqliteVecPackage: JSON.parse(readFileSync(join(root, "node_modules/sqlite-vec/package.json"), "utf8")).version },
      embeddingSpace: fixture.embeddingSpace,
      config: { ...fixture.config, modes, warmupsPerQueryMode: warmups, repeatsPerQueryMode: repeats,
        timingOrder: "query order, then dense-only, lexical-only, hybrid, hybrid-neighbors; sequential",
        latencyUnit: "milliseconds; nearest-rank percentiles; warmups excluded; retained repeat samples",
        localRetrievalIncludes: "production SQL, fusion, evidence selection and internal trace collection",
        metricRanking: "recall@k uses fused pre-budget ranking with k=limit; MRR@k uses the same primary top-k; full candidate first-support rank is diagnostic only; evidence metrics use actual returned items",
        evidenceByteContract: "UTF-8 text only; whole records; metadata and queries excluded" },
      timings: { ingestionTotalMs: ingestionMs,
        ingestionEmbedding: latencySummary(counters.document.samplesMs),
        ingestionOtherMs: ingestionMs - counters.document.samplesMs.reduce((a, b) => a + b, 0),
        queryEmbeddingTotalMs: queryEmbeddingMs,
        queryEmbedding: latencySummary(counters.query.samplesMs),
        embeddingSampleUnit: "one provider batch call; not per-query latency" },
      provider: { identity: "offline deterministic manually mapped Float32 vectors; no model inference",
        document: { calls: counters.document.calls, inputs: counters.document.inputs, inputUtf8Bytes: counters.document.inputUtf8Bytes },
        query: { calls: counters.query.calls, inputs: counters.query.inputs, inputUtf8Bytes: counters.query.inputUtf8Bytes },
        queryVectorReuse: "one prepared vector per unique query reused by dense-only, hybrid and hybrid-neighbors; lexical-only requires zero vectors/calls",
        uniqueQueryVectorsPerMode: { "dense-only": queries.length, "lexical-only": 0, hybrid: queries.length, "hybrid-neighbors": queries.length },
        httpAttempts: 0, ner: { calls: 0 }, reranker: { calls: 0 }, reader: { calls: 0, inputTokens: 0, outputTokens: 0 },
        paidServiceCalls: 0 },
      interpretation: "Retrieval/support coverage and annotated evidence exposure only. No answer correctness, semantic abstention, paper parity, real-model quality or performance superiority claim.",
      resultSha256: checksum(JSON.stringify(stableSamples)), byMode, samples,
    };
  } finally {
    if (memory) await memory.close();
    if (db) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { output: { type: "string" },
    warmups: { type: "string", default: "2" }, repeats: { type: "string", default: "5" } } });
  const report = await runEvaluation({ warmups: Number(values.warmups), repeats: Number(values.repeats) });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output) writeFileSync(resolve(values.output), json);
  else process.stdout.write(json);
}
