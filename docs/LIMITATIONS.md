# Limitations

## Current Implementation

- This repository contains build tooling and design documents only. `src/index.ts` exports no memory API.
- SQLite drivers, sqlite-vec, embeddings, entity extraction, ingestion, retrieval, final QA, and benchmark evaluation are not implemented.
- There is no behavioral test suite or CI matrix yet. Type checking, compilation, and loading an empty entry point do not validate memory behavior.
- No performance, accuracy, concurrency, or paper-parity claims have been established.

## Runtime and Platform Coverage

The bootstrap was checked locally on macOS using Node.js 22.23.3 and Bun 1.4.4. A separate, isolated macOS ARM64 probe also verified better-sqlite3 13.0.3 with sqlite-vec 0.1.9 (SQLite 3.53.4) in both runtimes: vector/FTS5 operations, rollback, deletion, and cross-runtime persistence passed without a custom dylib. These probes are not a shipped storage implementation. Windows x64, Linux, macOS x64, and other runtime versions remain unverified. Windows ARM64 is out of scope, with no compatibility work planned.

| Target | Known constraint | Required evidence |
| --- | --- | --- |
| macOS with `bun:sqlite` (alternative) | Apple's SQLite cannot load extensions | Use a custom SQLite library before any connection opens; the recommended shared driver avoids this path |
| Windows x64 | sqlite-vec publishes a binary | Verify installation, loading, paths, and persistence |
| Windows ARM64 | Out of scope; sqlite-vec 0.1.9 has no packaged binary | Not applicable; support is not planned |
| Linux x64/ARM64 | sqlite-vec publishes binaries | Verify the actual distribution and architecture; musl is unverified |
| macOS x64/ARM64 | Shared driver probe passed on ARM64 only | Test x64 and the eventual package integration separately |

If the alternative `bun:sqlite` driver is adopted, Homebrew can install SQLite using `brew install sqlite` and discover its prefix with `brew --prefix sqlite`. Call `Database.setCustomSQLite()` with the resulting `lib/libsqlite3.dylib` path before opening a database. Do not hardcode `/opt/homebrew` or `/usr/local`. The shared better-sqlite3 recommendation does not require this setup; no one-mem configuration option implements it.

Do not omit optional dependencies when installing sqlite-vec: its platform binaries are optional packages. Package version, SQLite build, OS, architecture, and C library affect compatibility. As researched on 2026-11-10, better-sqlite3 13.0.3 bundles N-API binaries and has no install script; advice for older releases may differ. The local probe does not validate every Node.js/Bun version allowed by the package's engine ranges.

## Research and Data

The user selected 10,000 and 100,000 records as initial evaluation sizes while production volume remains unknown. [Local benchmarks](BENCHMARKS.md) use synthetic 384-dimensional vectors and warm in-memory queries. They do not measure disk behavior, embedding generation, FTS5/RRF, concurrency, or full application latency, and do not establish a capacity guarantee.

The reference uses English-oriented NER and query heuristics. Multilingual support, including Vietnamese input, requires its own validation. Embedding models, entity extraction, vector dimensions, and reader budgets remain open choices.

Reference benchmark figures are reported by the paper, not measurements of one-mem. A future comparison must record dataset versions, models, settings, and evaluation scripts. “Zero-token” refers to avoiding generative LLM calls in memory operations, not free embeddings or final QA.

The supplied nine-page paper v1 evaluates a graph/hierarchy system with query-conditioned fusion, closure, and calibration; it does not evaluate one-mem's SQLite/FTS5/RRF simplification. Its reported 57.6% reduction concerns memory-operation time relative to LightMem in a controlled setup, not SQL query latency, end-to-end QA, or our local vector benchmarks. The paper's primary top-k precedes closure, and exact final context-token limits, dataset splits/counts, and repeated-run uncertainty are not fully specified. See [paper analysis](PAPER_ANALYSIS.md) before using its figures as comparison targets.

Database encryption, access control, retention, and production deployment are not implemented. Local database files are ignored by Git; that alone is not a data-security boundary.

## Sources

[Bun SQLite](https://bun.com/docs/runtime/sqlite), [sqlite-vec JavaScript guide](https://alexgarcia.xyz/sqlite-vec/js.html), [sqlite-vec package metadata](https://registry.npmjs.org/sqlite-vec/0.1.9), [better-sqlite3 package metadata](https://registry.npmjs.org/better-sqlite3/13.0.3).
