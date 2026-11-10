# Limitations

## Current Implementation

- This repository contains build tooling and design documents only. `src/index.ts` exports no memory API.
- SQLite drivers, sqlite-vec, embeddings, entity extraction, ingestion, retrieval, final QA, and benchmark evaluation are not implemented.
- There is no behavioral test suite or CI matrix yet. Type checking, compilation, and loading an empty entry point do not validate memory behavior.
- No performance, accuracy, concurrency, or paper-parity claims have been established.

## Runtime and Platform Coverage

The bootstrap was checked locally on macOS using Node.js 22.23.3 and Bun 1.4.4. Windows x64 and Linux remain unverified, as do native SQLite loading and other runtime versions on all systems. Windows ARM64 is out of scope, with no compatibility work planned.

| Target | Known constraint | Required evidence |
| --- | --- | --- |
| macOS with Bun | Apple's SQLite cannot load extensions | Use a custom SQLite library before any connection opens |
| Windows x64 | sqlite-vec publishes a binary | Verify installation, loading, paths, and persistence |
| Windows ARM64 | Out of scope; sqlite-vec 0.1.9 has no packaged binary | Not applicable; support is not planned |
| Linux x64/ARM64 | sqlite-vec publishes binaries | Verify the actual distribution and architecture; musl is unverified |
| macOS x64/ARM64 | sqlite-vec publishes binaries | Test each architecture and driver independently |

With Homebrew, a future Bun/macOS setup can install SQLite using `brew install sqlite` and discover its prefix with `brew --prefix sqlite`. Call `Database.setCustomSQLite()` with the resulting `lib/libsqlite3.dylib` path before opening a database. Do not hardcode `/opt/homebrew` or `/usr/local`. No one-mem configuration option implements this setup yet.

Do not omit optional dependencies when installing sqlite-vec: its platform binaries are optional packages. Package version, SQLite build, OS, architecture, and C library affect compatibility. As researched on 2026-11-10, better-sqlite3 13.0.3 bundles N-API binaries and has no install script; advice for older releases may differ. Its exact compatibility with Bun 1.4.4 remains untested.

## Research and Data

The reference uses English-oriented NER and query heuristics. Multilingual support, including Vietnamese input, requires its own validation. Embedding models, entity extraction, vector dimensions, and reader budgets remain open choices.

Reference benchmark figures are reported by the paper, not measurements of one-mem. A future comparison must record dataset versions, models, settings, and evaluation scripts. “Zero-token” refers to avoiding generative LLM calls in memory operations, not free embeddings or final QA.

Database encryption, access control, retention, and production deployment are not implemented. Local database files are ignored by Git; that alone is not a data-security boundary.

## Sources

[Bun SQLite](https://bun.com/docs/runtime/sqlite), [sqlite-vec JavaScript guide](https://alexgarcia.xyz/sqlite-vec/js.html), [sqlite-vec package metadata](https://registry.npmjs.org/sqlite-vec/0.1.9), [better-sqlite3 package metadata](https://registry.npmjs.org/better-sqlite3/13.0.3).
