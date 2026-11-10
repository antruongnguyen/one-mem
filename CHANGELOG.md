# Changelog

## Unreleased

### Changed

- Revised the proposed implementation toward shared SQLite integration, hybrid retrieval, and evaluation-gated graph features.
- Documented Windows x64 as the Windows target and Windows ARM64 as outside project scope.
- Kept search, scope, evidence, neighbors, and reader APIs for later phases; Phase 1 makes no retrieval or production-capacity claim.

### Added

- Added the private Phase 1 `openMemory` lifecycle API for durable `upsert`, `get`, `remove`, and `close`, with an injected cosine embedding provider and schema version 1.
- Added namespace and embedding-space validation, provenance revisions, serialized operations with close/drain behavior, and atomic record, vector-BLOB, and FTS5 writes. The schema and API remain experimental with no stable cross-release compatibility promise.
- Added deferred persistent WAL setup to memory open so unsupported or foreign schemas can be rejected without changing the database; retained Phase 0 native compatibility fixtures.
- Added the Phase 0 internal shared better-sqlite3/sqlite-vec connection, compiled native compatibility tests, and a native CI matrix with explicit architecture checks.
- Added a reproducible file-backed storage benchmark while retaining inline vector BLOBs and scalar cosine as the provisional baseline; no public memory API or durable schema is introduced.
- Added paper-grounded architecture and evaluation notes, plus author acknowledgements and a direct paper link in the README.
- Added local 10,000/100,000-record vector benchmarks with metadata selectivity, matched runtime results, and explicit measurement limits.
- Added source-based reference analysis, an implementation plan, and isolated local SQLite compatibility evidence.
- Bootstrapped the TypeScript ES module package and its Bun install, typecheck, and build setup.
- Added Git ignore rules, project documentation, and an MIT license.
