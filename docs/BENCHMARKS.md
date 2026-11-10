# Storage benchmarks

The original vector-layout comparison below was measured locally on 2026-11-10 as an isolated SQL probe. At 10,000 and 100,000 records, `vec0` reduced query latency for unfiltered and 50%-selected searches; indexed inline BLOB search was faster when metadata selected 1% of records. These measurements support inline BLOBs as the simpler initial baseline pending a real workload and latency budget. The later [Phase 0 file-backed measurement](#phase-0-file-backed-storage-measurement) uses the implemented internal connection and records the remaining performance gate. Neither is a benchmark of a public one-mem memory engine.

## Results

Times are milliseconds, shown as **p50 / p95** across 90 measured queries per layout, runtime, corpus size, and filter case. Percentiles use nearest rank, `sorted[ceil(p * n) - 1]`. Each runtime ran once, sequentially: Node.js first, then Bun.

| Runtime | Total records | Selected records | Filter | Inline scalar p50 / p95 | vec0 p50 / p95 |
| --- | ---: | ---: | --- | ---: | ---: |
| Node.js | 10,000 | 10,000 | None | 4.472 / 4.697 | 3.017 / 3.113 |
| Node.js | 10,000 | 5,000 | 50% | 3.314 / 3.758 | 1.809 / 1.954 |
| Node.js | 10,000 | 100 | 1% | 0.068 / 0.081 | 0.523 / 0.598 |
| Node.js | 100,000 | 100,000 | None | 44.636 / 46.836 | 29.573 / 30.418 |
| Node.js | 100,000 | 50,000 | 50% | 37.731 / 38.147 | 17.604 / 17.947 |
| Node.js | 100,000 | 1,000 | 1% | 0.851 / 1.133 | 5.400 / 5.832 |
| Bun | 10,000 | 10,000 | None | 4.491 / 4.815 | 3.019 / 3.224 |
| Bun | 10,000 | 5,000 | 50% | 3.159 / 3.574 | 1.767 / 1.917 |
| Bun | 10,000 | 100 | 1% | 0.072 / 0.101 | 0.544 / 0.631 |
| Bun | 100,000 | 100,000 | None | 45.270 / 58.455 | 30.126 / 38.004 |
| Bun | 100,000 | 50,000 | 50% | 39.134 / 41.239 | 18.220 / 20.210 |
| Bun | 100,000 | 1,000 | 1% | 0.922 / 1.262 | 5.671 / 6.211 |

Every measured pair and warmup returned exactly ten results with identical IDs and order across layouts. Returned top-ten distances were strictly increasing, with no ties; the maximum observed scalar/vec0 distance delta was **0**. Dataset hashes, query hashes, IDs, and distances also matched between runtimes.

## Environment and method

- macOS 26.7.1, Darwin 25.6.0, ARM64; Apple M3 Pro, 12 logical CPUs, 36 GiB system RAM.
- Node.js 22.23.3 and Bun 1.4.4; Bun reported Node compatibility version 26.3.0. Versions were read dynamically from each process.
- Existing isolated probe dependencies: better-sqlite3 13.0.3, sqlite-vec package 0.1.9, loaded extension `v0.1.9`, SQLite 3.53.4. Both runtimes used the same driver and extension, not Bun's built-in SQLite driver.
- A fresh `:memory:` database for each size; both layouts and both relational metadata indexes coexisted in it. No disk I/O was included. Statements were prepared before timing, and there was no explicit `ANALYZE`, pragma tuning, or manual garbage collection.
- Three fixed query vectors, two warmup pairs per query/case, then 30 measured pairs per query/case: 90 samples per layout/case. `performance.now()` surrounded synchronous `statement.all()`, including native parameter binding and materializing ten result rows. Data generation, database construction, statement preparation, and correctness checks were outside query timing.
- Within each case, each query was repeated 30 times before the next query. Scalar/vec0 alternated first execution on every pair, giving 45 measured first executions to each layout. Cases ran in order: no filter, 50%, 1%; sizes ran 10,000 then 100,000.
- Node.js completed before Bun started. No other benchmark was run by this task concurrently; ordinary desktop background activity remained. Results describe warm in-memory queries on this machine, not an isolated production environment or a p95 service guarantee.

## Exact workload

Vectors were synthetic normalized `Float32Array(384)` values; `k = 10`, cosine distance, deterministic integer IDs `1..N`. Metadata was `half = id % 2`, `bucket = id % 100`. The 50% case selected `half = 0`; the 1% case selected `bucket = 0`. These selections overlap: every selected bucket-zero ID is also even.

The generator used a 32-bit LCG: `seed = (Math.imul(1664525, seed) + 1013904223) >>> 0`; each raw component was `seed / 4294967296 - 0.5`, rounded into Float32. Sum the squared Float32 components in JavaScript Number precision, take the square root, and divide each Float32 component by that norm, rounding back to Float32. Assert finite components and a finite nonzero pre-normalization norm; store the resulting native Float32 bytes as a BLOB (little-endian on this host).

Generate the three query vectors once with seed **987654321**. Independently reset the record generator to seed **123456789** before each corpus size, giving identical first 10,000 records in both sizes. Both layouts receive the same vector bytes and metadata; both runtimes reconstruct this exact fixture.

Schema:

```sql
CREATE TABLE records(
  id INTEGER PRIMARY KEY,
  half INTEGER NOT NULL,
  bucket INTEGER NOT NULL,
  embedding BLOB NOT NULL
    CHECK(length(embedding) = 1536)
    CHECK(vec_length(embedding) = 384)
) STRICT;
CREATE INDEX records_half ON records(half);
CREATE INDEX records_bucket ON records(bucket);
CREATE VIRTUAL TABLE vectors USING vec0(
  id INTEGER PRIMARY KEY,
  embedding float[384] distance_metric=cosine,
  half INTEGER,
  bucket INTEGER
);
```

Inline query, omitting `WHERE` when unfiltered and substituting `bucket` for the 1% case:

```sql
SELECT id, vec_distance_cosine(embedding, ?) AS distance
FROM records WHERE half = ?
ORDER BY distance, id LIMIT ?;
```

vec0 query, omitting the final metadata predicate when unfiltered and substituting `bucket` for the 1% case:

```sql
SELECT id, distance FROM vectors
WHERE embedding MATCH ? AND k = ? AND half = ?
ORDER BY distance;
```

Parameters were native BLOBs, numeric `k = 10`, and BigInt metadata predicates `0n`. vec0 insert IDs and INTEGER metadata used BigInt (`better-sqlite3` binds JavaScript Numbers as FLOAT, which vec0 rejects for these INTEGER metadata columns). `defaultSafeIntegers(true)` kept returned IDs as BigInt. Scalar inserts also used BigInt IDs; their metadata Numbers were accepted by the STRICT relational INTEGER columns. Both searches are exact; no approximate index, partition key, quantization, or application-side postfilter was used.

## Local artifacts and commands

The following commands were executed from the repository root against **existing ignored local probe files and installed dependencies**. They are not runnable package scripts in a clean checkout. Reproduction elsewhere requires an isolated scratch project with better-sqlite3 13.0.3 and sqlite-vec 0.1.9, including the platform binary, and a script implementing the workload and sampling method above. No root package dependencies were added.

```sh
node docs/superpowers/probes/shared-sqlite/benchmark-target-sizes.js docs/superpowers/probes/shared-sqlite/benchmark-target-sizes-node.json
bun docs/superpowers/probes/shared-sqlite/benchmark-target-sizes.js docs/superpowers/probes/shared-sqlite/benchmark-target-sizes-bun.json
```

Those JSON files retain dynamic environment metadata, all 90 timing pairs per case, and per-query result IDs/distances. The query-byte SHA-256 is `5a1c9573e19e6a21818a0e075380182befe58bcd8a08ece1e7e5012f4f0bd600`. Dataset SHA-256 hashes, computed by appending UTF-8 `${id}:${half}:${bucket}:` then each vector BLOB in insertion order, are:

- 10,000: `9737bcc89593e39679bcbd2a543770322d1db980d751e4f45d42879dee84f945`.
- 100,000: `fc4fac7c243d914b09a68aead03c312d8c4c9c9f59adfc1781d2f84c647c02bc`.

## Interpretation and next gate

At p50, vec0 was about 1.5–2.1 times faster for broad searches in this fixture. At 1% selectivity, indexed scalar search was about 6–8 times faster. Total corpus size alone therefore does not select a layout: the number of eligible records and metadata predicates matter. The probe does not establish which runtime is faster.

Keep inline BLOBs as the simple baseline for atomic record/embedding updates, with vec0 a concrete candidate when broad searches miss the agreed latency budget. Before selecting the shipped layout, measure representative embeddings, real filter combinations and scope distributions, and the expected query/update mix against that budget; verify lifecycle consistency for any additional vec0 table. Do not add dual storage or adaptive routing based only on these synthetic cases.

Disk size, memory differences, cold-cache latency, write/update/delete cost, concurrent workloads, embedding generation, FTS/hybrid retrieval, final QA, and Windows/Linux/macOS x64 performance were not measured. Because both layouts coexisted, this probe cannot establish comparative storage or memory costs. Neither production-scale suitability nor benchmark parity with a reference implementation follows from these results.

## Phase 0 file-backed storage measurement

Measured locally on 2026-11-10 using the tracked `scripts/benchmark-storage.mjs`, compiled internal `openStorage`, and compiled test fixture schema. This adds missing file-backed evidence; the completed in-memory scalar/vec0 comparison above was not repeated. There is no product hybrid retrieval API in Phase 0.

The provisional local threshold was declared **before execution: warm hybrid p95 <= 100 ms**. It passed at 10k and for 1%-selected 100k queries, but **failed for unfiltered and 50%-selected 100k queries in both runtimes**. The threshold has not been raised. Benchmark execution is complete; performance acceptance remains open.

| Runtime | Total records | Eligible records | Filter | Hybrid p50 / p95 (ms) | 100 ms p95 threshold |
| --- | ---: | ---: | --- | ---: | --- |
| Node.js | 10,000 | 10,000 | none | 9.035 / 9.506 | Pass |
| Node.js | 10,000 | 5,000 | 50% | 7.461 / 7.776 | Pass |
| Node.js | 10,000 | 100 | 1% | 0.302 / 0.311 | Pass |
| Node.js | 100,000 | 100,000 | none | 102.087 / 105.668 | **Miss** |
| Node.js | 100,000 | 50,000 | 50% | 93.065 / 104.025 | **Miss** |
| Node.js | 100,000 | 1,000 | 1% | 13.679 / 15.398 | Pass |
| Bun | 10,000 | 10,000 | none | 8.680 / 8.971 | Pass |
| Bun | 10,000 | 5,000 | 50% | 7.191 / 8.372 | Pass |
| Bun | 10,000 | 100 | 1% | 0.300 / 0.312 | Pass |
| Bun | 100,000 | 100,000 | none | 103.376 / 113.431 | **Miss** |
| Bun | 100,000 | 50,000 | 50% | 95.346 / 111.036 | **Miss** |
| Bun | 100,000 | 1,000 | 1% | 13.262 / 14.096 | Pass |

| Runtime | Records inserted in one transaction | Insert + commit (ms) | Update 1,000 rows + commit (ms) | Main DB bytes after updates/checkpoint/close |
| --- | ---: | ---: | ---: | ---: |
| Node.js | 10,000 | 160.494 | 11.803 | 21,168,128 |
| Node.js | 100,000 | 2655.472 | 12.525 | 211,369,984 |
| Bun | 10,000 | 154.326 | 11.076 | 21,168,128 |
| Bun | 100,000 | 2639.400 | 11.913 | 211,369,984 |

### Method and checks

- Environment: Apple M3 Pro, 12 logical CPUs, 36 GiB RAM, macOS ARM64/Darwin 25.6.0; Node 22.23.3 then Bun 1.4.4, one sequential run each. better-sqlite3 13.0.3, sqlite-vec 0.1.9, loaded extension `v0.1.9`, driver SQLite 3.53.4. Runtime-bundled SQLite versions are not the driver's SQLite version.
- Fresh local temporary database per size, in a path containing spaces and Unicode. WAL, foreign keys enabled, 5,000 ms busy timeout, observed `synchronous = 1` (NORMAL). No explicit ANALYZE, cache tuning, cache eviction, or manual GC. Queries run after close/reopen but retain a warm OS cache; these are not cold-disk measurements. NORMAL/WAL is not evidence of power-loss durability; crash testing remains future work.
- Same deterministic normalized 384-dimensional vectors, seeds, query SHA-256, and dataset SHA-256 values as above, now explicitly encoded little-endian. The script asserts those hashes. Vectors are generated before write timing; text/parameter creation, SQL execution, external-content FTS triggers, and transaction commit are inside write timing. Schema setup is excluded. The fixture omits later memory metadata/settings and is not a supported durable schema.
- Source is `id % 2`, session is `id % 100`, and caller IDs are zero-padded six-digit ASCII strings. No filter selects all rows; source `0` selects 50%; source `0` plus session `0` selects 1%. Text is `common record ID needle` for IDs divisible by ten and `common record ID ordinary` otherwise. The lexical query is `needle`: it matches 10%, 20%, and 100% of eligible rows in those three scope cases respectively. These short synthetic records are workload assumptions, not representative documents or model quality evidence.
- Each branch applies the scope before taking 50 candidates. Dense sorts cosine ascending, lexical sorts BM25 ascending, and both break ties using binary caller IDs. Equal-weight RRF sums `1 / (60 + rank)`; final score ties use caller ID and return ten text-bearing rows. One synchronous read transaction includes both branches, materializing candidate text, JavaScript fusion/sorting, and final rows. Timings include that whole transaction, excluding result assertions. No embedding provider, public search validation, evidence budget, or neighbor logic is measured.
- For each of three fixed queries: one untimed reference call, two warmups, then 30 samples, giving 90 samples per runtime/size/scope. Percentiles use nearest rank. Raw samples and final IDs/text/scores are retained in generated JSON. Assertions verify ten finite-scored, correctly scoped, repeatable rows. The reference call is a determinism check, not an independent ranking-quality oracle. Comparing the two reports confirmed identical IDs, text, scores, and hashes between runtimes.
- After queries, one transaction replaces text and embeddings of IDs 1..1000. A truncate checkpoint and close precede size measurement. WAL and SHM sizes were both zero/absent at that point in both runtimes. Reopen assertions verify the total count, the 1,000 new FTS matches, removal of the old common term from changed rows, and all 1,000 changed vector BLOBs. Insertion/update figures are single batch observations, not write-latency percentiles. Storage size is a checkpointed logical file footprint, not peak disk usage, live WAL growth, or memory consumption.
- No other project tests or benchmarks ran concurrently. Ordinary desktop background activity remained. These measurements cannot compare Node and Bun performance or isolate the cause of the 100k misses.

### Reproduction and interpretation

From a clean checkout with both runtimes installed:

```sh
bun install --frozen-lockfile
bun run test:build
mkdir -p docs/superpowers/phase0
node scripts/benchmark-storage.mjs > docs/superpowers/phase0/benchmark-storage-node.json
bun scripts/benchmark-storage.mjs > docs/superpowers/phase0/benchmark-storage-bun.json
```

Run sequentially without other benchmarks. The script creates and removes its own temporary databases and prints JSON; it needs no pre-existing ignored probe, database, or reference file. Output reports remain ignored. Functional/assertion failures exit nonzero. Timing misses are recorded as `withinProvisionalBudget: false`, not made into hardware-sensitive unit-test failures.

Retain inline BLOB/scalar cosine as a **provisional** baseline. The 100k hybrid misses are concrete limits of this fixture; they do not establish that changing vector layout is necessary or sufficient, since FTS, file/page access, candidate materialization, and fusion are also included. Existing vec0 results concern a different in-memory branch workload. Do not rerun the benchmark to obtain a passing number or add a second authoritative vector store.

**Open acceptance item:** obtain representative embeddings/text/scopes/query-update mix and an agreed production budget, then attribute any misses before freezing the durable schema or selecting vec0. The substituted synthetic workload and local threshold are a material adjustment to the original Phase 0 gate, documented in [D006](DECISIONS.md#d006--phase-0-layout-and-evidence-boundary). Native storage verification is complete; production suitability and the failed local performance threshold are not passed gates.

## Sources

- [sqlite-vec KNN query documentation](https://alexgarcia.xyz/sqlite-vec/features/knn.html): scalar and vec0 query approaches.
- [sqlite-vec vec0 documentation](https://alexgarcia.xyz/sqlite-vec/features/vec0.html): metadata columns and query filtering.
- [sqlite-vec API reference](https://alexgarcia.xyz/sqlite-vec/api-reference.html): vector BLOB functions and cosine distance.
- [better-sqlite3 API documentation](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md): prepared statements and safe integers.
- Pinned package metadata: [better-sqlite3 13.0.3](https://registry.npmjs.org/better-sqlite3/13.0.3), [sqlite-vec 0.1.9](https://registry.npmjs.org/sqlite-vec/0.1.9).
