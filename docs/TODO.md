# TODO

Use [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for task details, contracts, and fixtures, and [REFERENCE_ANALYSIS.md](REFERENCE_ANALYSIS.md) for the rationale. This checklist reflects the revised hybrid-first recommendation, not a requirement to reproduce the Python implementation. Mark milestones complete only when their checks pass.

[PAPER_ANALYSIS.md](PAPER_ANALYSIS.md) records the manuscript's distinct design, reported results, and implications for these evaluation gates.

## 0. Project Bootstrap

- [x] Establish TypeScript ESM build tooling and English contributor documentation.
- [x] Add README, changelog, MIT license, architecture, decisions, and limitations.
- [x] Initialize Git conventions and exclude `docs/superpowers/` and local data.
- [x] Verify the bootstrap, review it, and record the initial commit.

## 1. SQLite Compatibility

- [x] Probe shared better-sqlite3/sqlite-vec on local macOS ARM64 in Node.js and Bun, including exchanged database files.
- [x] Pin the verified better-sqlite3 13.0.3 and sqlite-vec 0.1.9 packages, Node 22 types, and driver types.
- [x] Turn isolated probe cases into compiled package tests: native loading, vector/FTS operations, scoped top-k, bigint keys, binding, rollback, deletion, reopen, and cross-runtime writes.
- [x] Compare warm in-memory vector queries at the user-selected 10,000 and 100,000 records, with no filter, 50%, and 1% selection; see [local results](BENCHMARKS.md).
- [x] Add a reproducible file-backed 384-dimensional fixture for insertion, updates, checkpointed disk size, and benchmark-only hybrid queries at 10k/100k, with a declared provisional local budget; see [results and limits](BENCHMARKS.md).
- [ ] Validate representative production embeddings, text, filters, query/update mix, and storage costs against an agreed workload and latency budget before freezing the durable schema. Synthetic Phase 0 evidence does not close this gate.
- [x] Configure Windows x64, Linux glibc x64/ARM64, and macOS ARM64/x64 CI lanes for both pinned runtimes, plus a current-runtime Linux lane. Assert actual architecture and document unexecuted coverage. Windows ARM64 remains out of scope.
- [ ] Obtain passing native CI results before advertising support beyond locally verified macOS ARM64. No remote CI run was performed in Phase 0.

**Phase 0 evidence:** the shared driver passes package fixtures locally in Node.js and Bun; native/extension failures are actionable. Configured lanes still require execution before expanding support claims. Keep the scalar inline baseline and one driver; production suitability remains open as recorded in [D006](DECISIONS.md#d006--phase-0-layout-and-evidence-boundary).

## 2. Durable Ingestion

- [ ] Implement explicit source/session/order metadata and database namespace ownership using the plan's contracts.
- [ ] Treat new observations as distinct trace IDs; test preservation of contradictory historical statements and reserve upsert for explicit source-record replacement.
- [ ] Implement migrations and atomic, idempotent writes with update/delete semantics.
- [ ] Persist embedding-space identity, dimension, and metric; reject incompatible, nonfinite, and zero-norm vectors.
- [ ] Accept caller-supplied embeddings through a narrow provider contract, with inference outside SQL transactions.

**Done when:** restart, duplicate text from distinct sources, rollback, namespace isolation, and incompatible-vector fixtures pass.

## 3. Hybrid Retrieval

- [ ] Add query embeddings and exact vector search with filters applied before top-k.
- [ ] Add FTS5 lexical retrieval with safely compiled literal terms and matching filters.
- [ ] Fuse candidate ranks with deterministic reciprocal rank fusion and stable ties.
- [ ] Enforce the evidence-text byte budget as soon as the search API is introduced.
- [ ] Test known neighbors, rare exact terms, identifiers, empty branches, filtered results, and persisted updates.

**Done when:** identical fixtures return equivalent evidence under Node.js and Bun without generative LLM calls.

## 4. Context and Evidence

- [ ] Fetch bounded neighbors from the same source/session using explicit ordinal metadata.
- [ ] Deduplicate record identity without merging distinct-source provenance.
- [ ] Enforce the plan's explicit evidence-text byte budget and test Unicode boundaries.
- [ ] Preserve record revisions and distinguish recording time from event-time claims.

## 5. Evaluation and Optional Experiments

- [ ] Compare dense, lexical, hybrid, and hybrid-with-neighbors at equal evidence budgets.
- [ ] Add distributed/multi-hop, temporal-state, aggregation, conflicting-evidence, and no-answer slices; report complete supporting-source coverage and scope violations.
- [ ] Record primary, expanded, and final evidence counts and bytes separately; fix actual final prompt tokens and reader settings for later QA comparisons.
- [ ] Report retrieval quality separately from final-answer quality, plus latency, storage, and model calls.
- [ ] Prioritize a scoped graph/relational-support experiment for distributed-evidence failures; evaluate hierarchy or reranking against their own diagnosed failures and the plan's promotion criteria.
- [ ] Keep gold answers, evidence labels, and dataset categories out of runtime retrieval inputs.

## 6. Optional Reader and Evaluation

- [ ] Add final QA separately from indexing/retrieval, with citation and call-accounting tests.
- [ ] Record models, datasets, configuration, and licenses for reproducible evaluation.
- [ ] Measure quality and performance before documenting parity or superiority.
- [ ] Define release, packaging, and upgrade procedures before enabling publication.
