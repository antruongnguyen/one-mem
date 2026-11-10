# Vector layout benchmark

Measured locally on 2026-11-10. This is an isolated SQL probe, not a benchmark of an implemented one-mem memory engine. At 10,000 and 100,000 records, `vec0` reduced query latency for unfiltered and 50%-selected searches; indexed inline BLOB search was faster when metadata selected 1% of records. These measurements support keeping both as candidates, with inline BLOBs as the simpler initial baseline pending a real workload and latency budget.

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

## Sources

- [sqlite-vec KNN query documentation](https://alexgarcia.xyz/sqlite-vec/features/knn.html): scalar and vec0 query approaches.
- [sqlite-vec vec0 documentation](https://alexgarcia.xyz/sqlite-vec/features/vec0.html): metadata columns and query filtering.
- [sqlite-vec API reference](https://alexgarcia.xyz/sqlite-vec/api-reference.html): vector BLOB functions and cosine distance.
- [better-sqlite3 API documentation](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md): prepared statements and safe integers.
- Pinned package metadata: [better-sqlite3 13.0.3](https://registry.npmjs.org/better-sqlite3/13.0.3), [sqlite-vec 0.1.9](https://registry.npmjs.org/sqlite-vec/0.1.9).
