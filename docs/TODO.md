# TODO

Use [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for task details, contracts, and fixtures, and [REFERENCE_ANALYSIS.md](REFERENCE_ANALYSIS.md) for the rationale. This checklist reflects the revised hybrid-first recommendation, not a requirement to reproduce the Python implementation. Mark milestones complete only when their checks pass.

## 0. Project Bootstrap

- [x] Establish TypeScript ESM build tooling and English contributor documentation.
- [x] Add README, changelog, MIT license, architecture, decisions, and limitations.
- [x] Initialize Git conventions and exclude `docs/superpowers/` and local data.
- [x] Verify the bootstrap, review it, and record the initial commit.

## 1. SQLite Compatibility

- [x] Probe shared better-sqlite3/sqlite-vec on local macOS ARM64 in Node.js and Bun, including exchanged database files.
- [ ] Pin driver and sqlite-vec versions after checking their compatibility.
- [ ] Turn isolated probe cases into package tests: vector/FTS operations, rollback, deletion, and reopen.
- [ ] Compare inline BLOB/scalar distance and vec0 on representative corpus sizes and query filters; record latency and storage costs.
- [ ] Add Windows x64, Linux, and macOS CI lanes for both runtimes. Windows ARM64 is out of scope, not a deferred lane. Record runner architectures and unsupported combinations explicitly.

**Done when:** the shared driver passes the same package fixtures on the documented runtime/platform matrix; failed extension loading gives actionable errors. Do not add a second driver without a demonstrated need.

## 2. Durable Ingestion

- [ ] Implement explicit source/session/order metadata and database namespace ownership using the plan's contracts.
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
- [ ] Report retrieval quality separately from final-answer quality, plus latency, storage, and model calls.
- [ ] Evaluate NER/graph/PPR, stored windows/episodes, or reranking only against diagnosed baseline failures; use the plan's promotion criteria.
- [ ] Keep gold answers, evidence labels, and dataset categories out of runtime retrieval inputs.

## 6. Optional Reader and Evaluation

- [ ] Add final QA separately from indexing/retrieval, with citation and call-accounting tests.
- [ ] Record models, datasets, configuration, and licenses for reproducible evaluation.
- [ ] Measure quality and performance before documenting parity or superiority.
- [ ] Define release, packaging, and upgrade procedures before enabling publication.
