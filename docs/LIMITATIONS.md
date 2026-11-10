# Limitations

## Current Implementation

- Phase 1 implements `openMemory`, atomic `upsert`, `get`, `remove`, and serialized `close`, using the shared better-sqlite3/sqlite-vec connection. It persists exact source records, UUID revisions, normalized vector BLOBs, namespace/space settings, and external-content FTS5 in schema version 1.
- The package and schema remain private and provisional. Reopen/persistence are tested, but no compatibility guarantee across releases or production capacity claim exists. Retrieval, entity extraction, context/evidence assembly, and final QA are not implemented; there is no `search` method yet.
- Native compatibility fixtures remain separate from the schema-v1 ingestion/lifecycle tests. The old storage benchmark still measures its smaller fixture schema, not Phase 1 metadata/validation or a public retrieval API. Unexecuted CI configuration does not establish platform support.
- No production performance, accuracy, concurrency, or paper-parity claims have been established.

## Runtime and Platform Coverage

The package is verified locally on macOS ARM64 using Node.js 22.23.3 and Bun 1.4.4 with better-sqlite3 13.0.3, sqlite-vec 0.1.9, and SQLite 3.53.4. Project fixtures cover native loading, FTS5 and stale-term maintenance, known cosine distances, filtering before top-k, bigint row keys, binding, rollback, deletion, reopen, and file exchange in both runtime directions without a custom dylib. The earlier ignored probes remain historical evidence, not a test dependency.

The following lanes are **configured, not executed by this local task**. Runner labels and architectures were checked against the [GitHub runner table](https://github.com/actions/runner-images/blob/main/README.md); actual availability, runner OS images, package installation and native execution still depend on a CI run. There has been no push or remote CI run for this work.

| CI runner | Expected platform / architecture | Runtime selection | Execution evidence |
| --- | --- | --- | --- |
| `windows-2025` | Windows x64 | Node 22.23.3 / Bun 1.4.4 | Unverified |
| `ubuntu-24.04` | Linux glibc x64 | Node 22.23.3 / Bun 1.4.4 | Unverified |
| `ubuntu-24.04-arm` | Linux glibc ARM64 | Node 22.23.3 / Bun 1.4.4 | Unverified |
| `macos-15` | macOS ARM64 | Node 22.23.3 / Bun 1.4.4 | Hosted image unverified; local macOS ARM64 passed |
| `macos-15-intel` | macOS x64 | Node 22.23.3 / Bun 1.4.4 | Unverified |
| `ubuntu-24.04` | Linux glibc x64 | Current Node LTS / latest Bun | Unverified; selected versions reported at execution |

Both executables must be on PATH for the compatibility suites. Cross-runtime tests fail rather than skip when either is missing. Windows ARM64 is out of scope, with no compatibility work planned; Linux musl has no configured lane and remains unverified.

### Phase 1 local verification record — 2026-11-10

Verified on the same local macOS ARM64 baseline: Node.js 22.23.3 and Bun 1.4.4. A fresh export of staged project files, with newly installed dependencies and no ignored probes, local references, prebuilt output, or sibling checkout, passed:

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed; no dependency changes in Phase 1 |
| `bun run typecheck`, `bun run build`, `bun run test:build` | Passed |
| `bun run test:node` | 69 passed, 0 failed, 0 skipped |
| `bun run test:bun` | 69 passed, 0 failed; no skipped cases |
| Built entry in both runtimes | `openMemory` and `MemoryError` exports loaded |
| README TypeScript example | Ran under Bun, then Node with `--experimental-strip-types`; identical persisted record/revision |

The 69 cases comprise 53 Phase 1 ingestion/input/lifecycle cases and the 16 original native compatibility cases. Tests cover exact provenance, unchanged/corrected records, retained conflicting observations, model/settings validation, normalized byte encoding, atomic ordinal swaps, concurrent-handle revision conflicts, FTS/vector rollback, cancellation, close draining, and public-API file exchange between runtimes.

Independent review found and verified fixes for sparse-array validation and malformed Unicode preservation, alongside the related cancellation/settings regressions. Eight focused regressions passed independently in both runtimes. A separate exclusive-lock probe confirmed `BUSY` and cause preservation for get/snapshot/remove. No actionable review findings remain. CI lanes were not executed, benchmarks were not repeated, and the Phase 0 performance gate remains open.

### Phase 0 local verification record — 2026-11-10

The following also passed in a fresh export of the staged project files, with a new dependency installation and without ignored probes, local references, prebuilt output, or the sibling zero-mem checkout:

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed; native optional package retained |
| `bun run typecheck` / `bun run build` | Passed |
| `bun run test:build` | Passed; tests import compiled package modules |
| `bun run test:node` | 16 passed, 0 failed, 0 skipped |
| `bun run test:bun` | 16 passed, 0 failed, 0 skipped |
| Import `dist/index.js` in Node and Bun | Passed; public entry remains empty |
| Native workflow YAML parsing | Passed; remote jobs not executed |

The test-first run compiled successfully and failed with the intended missing storage implementation in both runtimes. Native missing/corrupt binary and missing extension cases use isolated copies of real dependency JavaScript without changing the project's installed packages. These checks establish local compatibility, not crash recovery, power-loss durability, concurrency behavior, or the later memory API.

An independent Phase 0 review found no actionable issues and confirmed error-cause preservation during failed initialization/cleanup in both runtimes. Approval covers the storage foundation and verification work; the performance acceptance item below remains open.

| Target | Known constraint | Required evidence |
| --- | --- | --- |
| macOS with `bun:sqlite` (alternative) | Apple's SQLite cannot load extensions | Use a custom SQLite library before any connection opens; the recommended shared driver avoids this path |
| Windows x64 | sqlite-vec publishes a binary | Verify installation, loading, paths, and persistence |
| Windows ARM64 | Out of scope; sqlite-vec 0.1.9 has no packaged binary | Not applicable; support is not planned |
| Linux x64/ARM64 | sqlite-vec publishes binaries | Verify the actual distribution and architecture; musl is unverified |
| macOS x64/ARM64 | Shared package fixtures passed locally on ARM64 only | Test x64 and hosted ARM64 images separately |

If the alternative `bun:sqlite` driver is adopted, Homebrew can install SQLite using `brew install sqlite` and discover its prefix with `brew --prefix sqlite`. Call `Database.setCustomSQLite()` with the resulting `lib/libsqlite3.dylib` path before opening a database. Do not hardcode `/opt/homebrew` or `/usr/local`. The shared better-sqlite3 recommendation does not require this setup; no one-mem configuration option implements it.

Do not omit optional dependencies when installing sqlite-vec: its platform binaries are optional packages. Package version, SQLite build, OS, architecture, and C library affect compatibility. As researched on 2026-11-10, better-sqlite3 13.0.3 bundles N-API binaries and has no install script; advice for older releases may differ. The local probe does not validate every Node.js/Bun version allowed by the package's engine ranges.

## Research and Data

The user selected 10,000 and 100,000 records as initial evaluation sizes while production volume remains unknown. [Local benchmarks](BENCHMARKS.md) retain the synthetic in-memory scalar/vec0 comparison and add file-backed insertion, updates, checkpointed disk size, and benchmark-only dense/FTS5/RRF timings. These are warm-cache synthetic fixtures, not cold-disk, representative corpus, concurrent, embedding-generation, or complete application measurements. They establish no capacity guarantee.

The original Phase 0 representative-workload gate remains unresolved: no production corpus or agreed latency budget was supplied. The recorded 384-dimensional workload and 100 ms warm hybrid p95 threshold are provisional local engineering assumptions. The threshold **failed for unfiltered and 50%-selected 100k queries in both runtimes** (unfiltered p95: Node 105.668 ms, Bun 113.431 ms). Measurement execution is complete, but performance acceptance remains open; resolve workload/budget and attribute the miss before freezing a durable Phase 1 schema. The combined timings do not show that changing to `vec0` is necessary or sufficient, so the inline baseline remains provisional.

The user's subsequent continuation authorizes Phase 1 functionality on this baseline, with an explicit distinction between versioned file persistence and a production schema-compatibility freeze. That continuation does not turn the failed threshold into a passed gate. No performance experiment was repeated for Phase 1, and Phase 0 timings must not be relabeled as measurements of the new ingestion API.

The reference uses English-oriented NER and query heuristics. Multilingual support, including Vietnamese input, requires its own validation. Embedding models, entity extraction, vector dimensions, and reader budgets remain open choices.

Reference benchmark figures are reported by the paper, not measurements of one-mem. A future comparison must record dataset versions, models, settings, and evaluation scripts. “Zero-token” refers to avoiding generative LLM calls in memory operations, not free embeddings or final QA.

The supplied nine-page paper v1 evaluates a graph/hierarchy system with query-conditioned fusion, closure, and calibration; it does not evaluate one-mem's SQLite/FTS5/RRF simplification. Its reported 57.6% reduction concerns memory-operation time relative to LightMem in a controlled setup, not SQL query latency, end-to-end QA, or our local vector benchmarks. The paper's primary top-k precedes closure, and exact final context-token limits, dataset splits/counts, and repeated-run uncertainty are not fully specified. See [paper analysis](PAPER_ANALYSIS.md) before using its figures as comparison targets.

Database encryption, access control, retention, and production deployment are not implemented. Local database files are ignored by Git; that alone is not a data-security boundary.

## Phase 1 Behavioral Boundaries

- Embeddings are supplied by the caller. The library validates the declared space and returned Float32 vectors but cannot establish model quality, stable preprocessing semantics, privacy, or hidden provider costs. Provider failures are not automatically retried. Changing model identity/dimension/metric requires a new database; open never silently re-embeds existing data.
- Inputs preserve well-formed Unicode text and IDs exactly. Unpaired UTF-16 surrogates are rejected instead of allowing SQLite's UTF-8 binding to replace characters or alias IDs. Timestamps require a valid calendar date/time with seconds and an explicit offset, and are canonicalized to UTC at JavaScript millisecond precision. Submillisecond precision is not retained. Records without `eventAt` do not infer one from `observedAt`.
- New observations need new caller IDs. Upsert of an existing ID is an explicit replacement with a new UUID revision; the previous content is not retained as revision history. Compare the returned revision when resolving an older citation.
- One handle serializes operations. Embedding awaits do not hold database locks; another handle may write and cause a `CONFLICT` during revision recheck. Native SQL remains synchronous and can block the event loop, including up to the configured 5,000 ms busy timeout. This is correctness coverage, not a concurrency-throughput or service-latency guarantee.
- Close waits for accepted operations; a provider ignoring its abort signal can delay completion. Cancellation before commit writes nothing and preserves the signal reason. Once committed, a write is not undone by subsequent cancellation.
- Remove is logical deletion from records/vector BLOBs/FTS, not physical erasure from WAL, free pages, backups, or storage media. Power-loss/crash recovery, network filesystems, encryption, and production backup procedures remain unverified.
- Version 1 initializes only empty version-0 databases. Foreign/fixture databases, incompatible namespaces/spaces, and newer schema versions are rejected. There are no prior released one-mem schemas to upgrade; upgrade/backup fixtures are required before the first future schema change. The Phase 0 performance gate still precedes production schema freeze.

## Sources

[Bun SQLite](https://bun.com/docs/runtime/sqlite), [sqlite-vec JavaScript guide](https://alexgarcia.xyz/sqlite-vec/js.html), [sqlite-vec package metadata](https://registry.npmjs.org/sqlite-vec/0.1.9), [better-sqlite3 package metadata](https://registry.npmjs.org/better-sqlite3/13.0.3).
