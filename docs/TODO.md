# TODO

Implement in order. Mark a milestone complete only when its checks pass, and update the architecture, decisions, limitations, and changelog alongside behavior changes.

## 0. Project Bootstrap

- [x] Establish TypeScript ESM build tooling and English contributor documentation.
- [x] Add README, changelog, MIT license, architecture, decisions, and limitations.
- [x] Initialize Git conventions and exclude `docs/superpowers/` and local data.
- [x] Verify the bootstrap, review it, and record the initial commit.

## 1. SQLite Compatibility

- [ ] Pin driver and sqlite-vec versions after checking their compatibility.
- [ ] Load the extension under Node.js and Bun and query its version.
- [ ] Insert known vectors, verify nearest-neighbor ordering, test rollback, and close/reopen the database.
- [ ] Verify macOS custom SQLite loading before any connection opens.
- [ ] Add Windows x64, Linux, and macOS CI lanes for both runtimes. Windows ARM64 is out of scope, not a deferred lane. Record runner architectures and unsupported combinations explicitly.

**Done when:** both drivers pass the same storage fixtures on the documented runtime/platform matrix; failed extension loading gives actionable errors.

## 2. Durable Ingestion

- [ ] Define records with source, session, speaker, ordering, and namespace metadata.
- [ ] Implement migrations and atomic, idempotent writes with update/delete semantics.
- [ ] Persist embedding model, dimension, and metric; reject incompatible input.
- [ ] Select the first embedding integration without coupling storage to a provider.

**Done when:** restart, duplicate text from distinct sources, rollback, namespace isolation, and incompatible-vector fixtures pass.

## 3. Dense Retrieval

- [ ] Add query embeddings, scoped vector search, and results with source references.
- [ ] Test known neighbors using deterministic vectors and persisted data.

**Done when:** identical fixtures return equivalent evidence under Node.js and Bun without generative LLM calls.

## 4. Graph and Temporal Context

- [ ] Evaluate entity extraction choices, then add entity relations and graph retrieval.
- [ ] Add temporal units that preserve session boundaries and source references.
- [ ] Test relation traversal, missing-entity fallback, temporal ordering, and bounded expansion independently.

## 5. Fusion and Evidence

- [ ] Add deterministic ranking, deduplication, and bounded evidence assembly.
- [ ] Define the budget unit explicitly and test its actual enforcement.
- [ ] Verify that every evidence item remains traceable to original text.

## 6. Optional Reader and Evaluation

- [ ] Add final QA separately from indexing/retrieval, with citation and call-accounting tests.
- [ ] Record models, datasets, configuration, and licenses for reproducible evaluation.
- [ ] Measure quality and performance before documenting parity or superiority.
- [ ] Define release, packaging, and upgrade procedures before enabling publication.
