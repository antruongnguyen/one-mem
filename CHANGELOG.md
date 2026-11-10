# Changelog

## Unreleased

### Changed

- Revised the proposed implementation toward shared SQLite integration, hybrid retrieval, and evaluation-gated graph features.
- Documented Windows x64 as the Windows target and Windows ARM64 as outside project scope.

### Added

- Added the Phase 0 internal shared better-sqlite3/sqlite-vec connection, compiled native compatibility tests, and a native CI matrix with explicit architecture checks.
- Added a reproducible file-backed storage benchmark while retaining inline vector BLOBs and scalar cosine as the provisional baseline; no public memory API or durable schema is introduced.
- Added paper-grounded architecture and evaluation notes, plus author acknowledgements and a direct paper link in the README.
- Added local 10,000/100,000-record vector benchmarks with metadata selectivity, matched runtime results, and explicit measurement limits.
- Added source-based reference analysis, an implementation plan, and isolated local SQLite compatibility evidence.
- Bootstrapped the TypeScript ES module package and its Bun install, typecheck, and build setup.
- Added Git ignore rules, project documentation, and an MIT license.
