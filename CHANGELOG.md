# Changelog

## Unreleased

### Changed

- Revised the proposed implementation toward shared SQLite integration, hybrid retrieval, and evaluation-gated graph features.
- Documented Windows x64 as the Windows target and Windows ARM64 as outside project scope.
- Added Phase 2 scoped dense and lexical search with rank-fused, whole-record evidence. Neighbor expansion remains Phase 3; graph retrieval and readers remain evaluation-gated follow-ups.
- Kept the private API and version-1 schema experimental without a stable cross-release compatibility promise; Phase 2 does not change the schema. The Phase 0 performance gate remains open, and Phase 2 adds no performance experiment or performance/retrieval-quality claim.
- Kept Phase 4 evaluation internal and offline. The synthetic fixture and its timing reports do not establish real-model retrieval quality or production capacity; the original Phase 0 performance gate remains open. Schema version 1, public search options, dependencies, and private publication status are unchanged.

### Added

- Added an independently authored synthetic retrieval evaluator comparing dense-only, lexical-only, hybrid, and hybrid-with-neighbors variants under a shared candidate cap and final evidence-byte budget. It records support retrieval and evidence-selection diagnostics; no gold labels reach retrieval or the embedding provider. See [evaluation notes](docs/EVALUATION.md).
- Added installed-tarball consumer checks, version-1 initialization and rollback coverage, backup/restore and separate-database model-space rebuild coverage, and CI artifacts for Node.js and Bun evaluation reports. See [upgrade guidance](docs/UPGRADING.md).
- Added Phase 3 bounded session context through `search(..., { neighbors })`: a default radius of 0 and maximum of 2 consecutive records on either side of selected matches, restricted to the same source/session and explicit sequence order. Match `limit` and byte priority remain separate from context; shared context is deduplicated by ID and attributed to its selected matches within the existing whole-record UTF-8 byte budget. The read snapshot includes matches and context; schema version 1 and dependencies are unchanged.
- Added the private Phase 1 `openMemory` lifecycle API for durable `upsert`, `get`, `remove`, and `close`, with an injected cosine embedding provider and schema version 1.
- Added Phase 2 `search(query, options)` with source/session filters applied before dense-cosine and literal-token FTS5 candidate limits, reciprocal rank fusion with constant 60, and whole-record UTF-8 text-byte-bounded evidence. Query embeddings use provider purpose `query`; results retain record revisions, match roles, available branch ranks, RRF scores, and retrieval diagnostics.
- Added namespace and embedding-space validation, provenance revisions, serialized operations with close/drain behavior, and atomic record, vector-BLOB, and FTS5 writes. The schema and API remain experimental with no stable cross-release compatibility promise.
- Added deferred persistent WAL setup to memory open so unsupported or foreign schemas can be rejected without changing the database; retained Phase 0 native compatibility fixtures.
- Added the Phase 0 internal shared better-sqlite3/sqlite-vec connection, compiled native compatibility tests, and a native CI matrix with explicit architecture checks.
- Added a reproducible file-backed storage benchmark while retaining inline vector BLOBs and scalar cosine as the provisional baseline; no public memory API or durable schema is introduced.
- Added paper-grounded architecture and evaluation notes, plus author acknowledgements and a direct paper link in the README.
- Added local 10,000/100,000-record vector benchmarks with metadata selectivity, matched runtime results, and explicit measurement limits.
- Added source-based reference analysis, an implementation plan, and isolated local SQLite compatibility evidence.
- Bootstrapped the TypeScript ES module package and its Bun install, typecheck, and build setup.
- Added Git ignore rules, project documentation, and an MIT license.
