# Offline Evaluation Baseline

Phase 4 adds a reproducible diagnostic evaluator, not a trained-model benchmark. The independently authored MIT fixture has **33 records and 19 queries** with manually assigned eight-dimensional vectors. It covers identifiers/numbers, designed paraphrases, relational and causal support, temporal/conflicting evidence, aggregation, duplicates, English/Vietnamese, missing metadata, scope boundaries, ordinal gaps, no-answer queries, and an oversized atomic note. It is not held out and cannot establish real-model quality or parity with the paper.

The four variants use the same production SQL, RRF, byte selector, and neighbor logic through internal entry points. No public `mode` option is added. Dense-only disables lexical input; lexical-only disables dense input and needs no query vector; hybrid enables both; hybrid-neighbors adds radius two. Each enabled branch has candidate cap **50**, derived from the production formula for `limit = 2`. Every mode uses the same **180 UTF-8 text-byte** budget. The oversized note is 258 bytes and deliberately tests whole-record omission without changing the budget to improve a metric.

## Reproduce

```sh
bun install --frozen-lockfile
bun run test:build
mkdir -p docs/superpowers/phase4
node scripts/evaluate.mjs --output docs/superpowers/phase4/evaluation-node.json
bun scripts/evaluate.mjs --output docs/superpowers/phase4/evaluation-bun.json
```

`bun run eval:node` and `bun run eval:bun` print JSON to stdout. The CLI accepts `--warmups` and `--repeats` (defaults 2 and 5). Run runtime measurements sequentially without other project benchmarks. Output files contain per-query stage IDs, records, metrics, per-slice denominators, raw timing samples, versions, and provenance. Generated local reports remain ignored; CI is configured to upload its own JSON artifacts after both runtime evaluations. A clone needs no ignored probe, reference checkout, model file, or API credential.

## Metrics and Label Boundaries

`inputs` in the fixture contains records and query text/scopes; the sibling `embeddings` section contains deterministic vector mappings. Gold support IDs, categories, and marked subject/temporal/boundary exposure IDs remain evaluator annotations; they never enter provider or search inputs. The manual vectors describe a designed synthetic task rather than inferred semantic capabilities.

There are **14 queries with nonempty support annotations**, **3 explicit no-answer queries**, and **2 unannotated queries**. Quality averages use only the 14 supported cases. Slices overlap and retain their own denominator counts; do not add slice counts as disjoint populations.

- Recall@2 and MRR@2 use primary top-two ranks before byte selection. Relevant evidence only at rank three gives MRR@2 zero. `firstCandidateSupportRank` is a separate full-ranking diagnostic.
- Evidence recall and complete-support coverage use actual final matched/context IDs under the byte cap. Complete coverage requires every annotated support ID, not merely the first hit.
- Explicit empty gold sets report irrelevant-evidence exposure separately. Unannotated/null gold is excluded. Neither inflates recall or coverage, and retrieval does not promise semantic abstention.
- Candidate misses, ranked cutoffs, primary/context byte losses, neighbor recoveries, and missing final evidence are reported as observable sets. These sets can overlap; do not sum them into exclusive failure totals.
- Scope violations are checked mechanically. Subject/temporal exposure markers are evaluator-provided labels, not a claim that the core reasons about subjects, latest state, or factual truth.

## Recorded Result — 2026-11-10

Node and Bun produced identical result checksums and metric values. Values below are fractions, not percentages.

| Variant | Recall@2 | MRR@2 | Evidence recall | Complete support | No-answer exposure rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| dense-only | 0.7560 | 0.8929 | 0.6845 | 0.5714 | 0.6667 |
| lexical-only | 0.8929 | 0.9643 | 0.8214 | 0.6429 | 0.3333 |
| hybrid | 0.8690 | 0.9643 | 0.7976 | 0.6429 | 0.6667 |
| hybrid-neighbors | 0.8690 | 0.9643 | 0.8393 | 0.7143 | 0.6667 |

No explicit source/session scope violations or neighbor-boundary violations occurred. Dense/hybrid modes returned annotated wrong-subject evidence twice; all modes returned annotated temporal distractors twice. These counts are evidence exposures, not answer-error rates. No reader was run.

Neighbor expansion recovered a required causal record outside primary top-k in the contiguous-context slice. It did not provide complete support for the distributed-relational or aggregation slice, and an ordinal-gap case retained missing evidence. The oversized-note case had recall@2 of 1 but evidence recall/complete support of 0 in all modes because the whole record exceeded 180 bytes. These are designed pipeline diagnostics, not sufficient grounds to promote a graph, reranker, tokenizer, or model adapter.

## Timing and Call Accounting

Environment: local macOS ARM64/Darwin 25.6.0, Apple M3 Pro, 12 logical CPUs, 36 GiB RAM; Node.js 22.23.3 and Bun 1.4.4; better-sqlite3 13.0.3, driver SQLite 3.53.4, sqlite-vec 0.1.9/extension `v0.1.9`. Runtime-bundled SQLite is not the driver's version.

Each runtime ingested a fresh local file database and reopened it before querying. This is a tiny warm-cache fixture; no cache eviction, cold-storage isolation, concurrency measurement, or model inference is included. Two warmups precede five recorded runs per query/mode, giving 95 samples per variant. Modes run in fixed query-then-mode order, Node first and Bun second. Mean and nearest-rank p50/p95 below mix all 19 query workloads for that variant, including empty scopes. Timing includes production SQL, fusion, evidence selection, and internal trace collection; metric calculation and reporting are outside it.

| Runtime | Variant | Samples | Mean ms | p50 / p95 ms |
| --- | --- | ---: | ---: | ---: |
| Node.js | dense-only | 95 | 0.1395 | 0.0703 / 0.4215 |
| Bun | dense-only | 95 | 0.1343 | 0.0712 / 0.3770 |
| Node.js | lexical-only | 95 | 0.1094 | 0.0782 / 0.2930 |
| Bun | lexical-only | 95 | 0.1015 | 0.0822 / 0.2661 |
| Node.js | hybrid | 95 | 0.1782 | 0.1097 / 0.5054 |
| Bun | hybrid | 95 | 0.1817 | 0.1105 / 0.4323 |
| Node.js | hybrid-neighbors | 95 | 0.1911 | 0.1159 / 0.4768 |
| Bun | hybrid-neighbors | 95 | 0.1820 | 0.1245 / 0.4220 |

- Node.js: ingestion total 3.9118 ms, including one document-provider batch 0.0890 ms; remaining ingestion work 3.8227 ms. Query preparation/normalization 0.0871 ms, including one query-provider batch 0.0092 ms.
- Bun: ingestion total 2.8908 ms, including one document-provider batch 0.0681 ms; remaining ingestion work 2.8227 ms. Query preparation/normalization 0.1845 ms, including one query-provider batch 0.0388 ms.

There was one document call for 33 inputs and one query call for 19 unique inputs per runtime. Query vectors are prepared once for the controlled comparison, including queries whose scopes are empty, then reused across dense/hybrid modes and repeats; lexical-only needs zero query vectors. These are batch timings, not per-query model latency or the public API's ordinary call schedule. HTTP attempts, paid service calls, NER, reranker, and reader calls are all zero for this synthetic provider. No final-QA tokens or accuracy were measured.

These samples cannot rank runtime performance, establish service latency or capacity, or close the earlier 100k/384-dimensional Phase 0 gate. See [BENCHMARKS.md](BENCHMARKS.md) for that distinct workload and its unresolved p95 misses.

## Provenance

The final report run followed a metadata correction to include source/build hashes and truthful absent-Git metadata; the fixture, vectors, metrics, and thresholds were unchanged. Initial local reports are retained separately under ignored scratch output. The existing 10k/100k layout experiment was not repeated.

- Generated at `2026-11-10T11:42:22.765Z` (Node) and `2026-11-10T11:42:22.918Z` (Bun).
- Git base `2bc383f2f5f39c46963b59ff1a20254fcf71f8b1`, with `dirty: true` because Phase 4 changes were not yet committed. The hashes identify the actual inputs/build; this is not falsely labeled as a clean run of the base commit.
- Fixture SHA-256: `90c004e894a50dd709476e66c85dcf0a93995db6fe7484859bd95d85f8a30428`.
- Source/input SHA-256: `0b3d952d9ea1a4212ad730bb8eb9c3e04053db9a2424435d321d5850405bd6fc`.
- Compiled dist SHA-256: `2e063f0b6b4f7a70ea118bc8abadfc8bb6f3ecb8af526c850d1ef432dd4a3ab5`.
- Deterministic result SHA-256: `985bce46e84bcb319a9a0cb43f4fef05ab756f59834ba3b23284bc95e7a58c15`.

Each report lists its source/dist files and hash definition: sorted forward-slash relative path, NUL, decimal byte length, NUL, exact bytes, repeated into SHA-256. Result checksums omit timings and random revisions, while preserving IDs/text/scores/ranks/anchors/metrics. Both runtimes matched all three source/build/result hashes. In an exported source tree without `.git`, Git fields are explicitly unavailable/null instead of borrowing a parent repository's identity.

## Before Real Evaluation or Release

Run the configured native CI lanes and packaged consumer checks first. Select a caller-owned embedding provider with a stable model/revision/preprocessing identity and licensed representative records. Create held-out query/support annotations, including no-answer and boundary cases, and keep labels out of runtime inputs. Measure real provider calls/attempts/costs separately from storage/retrieval at the actual workload and agreed latency budget. Keep final-QA evaluation separate with fixed reader, tokenizer, prompt, and decoding settings if a reader is explicitly added later.

Only promote optional graph, reranking, hierarchy, tokenizer, adapter, or reader experiments after their diagnosed failure slice and predeclared quality/cost gate justify them. The mandatory implementation sequence ends at Phase 4; these optional experiments are not automatically part of completion.
