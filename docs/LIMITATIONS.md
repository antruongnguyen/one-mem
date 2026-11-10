# Limitations

## Current Implementation

- Mandatory implementation phases 0–4 are present: atomic records, scoped hybrid search, bounded session context, offline evaluation, and packaged-consumer/upgrade verification tooling. Schema version 1 and the shared better-sqlite3/sqlite-vec connection are unchanged.
- The package and schema remain private and provisional. Reopen/persistence and deterministic retrieval/context fixtures are tested, but no compatibility guarantee across releases, retrieval-quality claim, or production capacity claim exists. Entity extraction, graph retrieval, reranking, and final QA are not implemented.
- Native compatibility fixtures remain separate from schema-v1 ingestion/lifecycle/retrieval tests. The old storage benchmark measures its smaller fixture schema, not the current public search API. Unexecuted CI configuration does not establish platform support.
- The synthetic [evaluation](EVALUATION.md) is a designed diagnostic fixture, not a real embedding-model or held-out quality benchmark. No production performance, accuracy, concurrency, or paper-parity claims have been established.

## Runtime and Platform Coverage

The package is verified locally on macOS ARM64 using Node.js 22.23.3 and Bun 1.4.4 with better-sqlite3 13.0.3, sqlite-vec 0.1.9, and SQLite 3.53.4. Project fixtures cover native loading, FTS5 and stale-term maintenance, known cosine distances, filtering before top-k, bigint row keys, binding, rollback, deletion, reopen, and file exchange in both runtime directions without a custom dylib. The earlier ignored probes remain historical evidence, not a test dependency.

The following lanes are **configured, not executed by this local task**. Runner labels and architectures were checked against the [GitHub runner table](https://github.com/actions/runner-images/blob/main/README.md); actual availability, runner OS images, package installation and native execution still depend on a CI run. There has been no push or remote CI run for this work.

| CI runner | Expected platform / architecture | Runtime selection | Execution evidence |
| --- | --- | --- | --- |
| `windows-2025` | Windows x64 | Node 22.23.3 / Bun 1.4.4 | Unverified |
| `ubuntu-24.04` | Linux glibc x64 | Node 22.23.3 / Bun 1.4.4 | Unverified |
| `ubuntu-24.04-arm` | Linux glibc ARM64 | Node 22.23.3 / Bun 1.4.4 | Unverified |
| `macos-15` | macOS ARM64 | Node 22.23.3 / Bun 1.4.4 | Hosted image unverified; local macOS ARM64 passed |
| `ubuntu-24.04` | Linux glibc x64 | Current Node LTS / latest Bun | Unverified; selected versions reported at execution |

macOS x64 is not part of the CI matrix and remains unverified. Both executables must be on PATH for the compatibility suites. Cross-runtime tests fail rather than skip when either is missing. Windows ARM64 is out of scope, with no compatibility work planned; Linux musl has no configured lane and remains unverified.

### Phase 4 local verification record — 2026-11-10

Verified locally on macOS ARM64 with Node.js 22.23.3 and Bun 1.4.4. A clean staged-file export without `.git`, ignored references/probes, or prebuilt output passed:

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed; native dependencies unchanged |
| `bun run typecheck`, `bun run build`, `bun run test:build` | Passed |
| `bun run test:node` | 131 passed, 0 failed, 0 skipped |
| `bun run test:bun` | 131 passed, 0 failed across 12 files; no skipped cases |
| `bun run test:package` | Actual tarball installed into an external consumer; strict declarations, export boundaries, native lifecycle/search/context, and persistence in both runtime directions passed |
| `bun run eval:node` / `bun run eval:bun` | Passed; source/dist/result hashes match the recorded baseline, with Git metadata correctly unavailable in the export |
| Built entry and README example | Passed in Node and Bun |
| Documented backup example | Ran in both runtimes; resulting backups retained frozen revisions and retrieval behavior |

The 131 cases retain the previous 118 and add nine evaluator/provenance cases plus four schema-v1 maintenance cases. The packaged-consumer harness is a separate check and inspects the actual archive's 16 compiled JS/declaration files plus README, LICENSE, and manifest; it excludes source/tests/probes/databases and verifies the installed entry by package name.

Independent review found no actionable code issues and recomputed the report metrics/hashes from actual IDs and bytes. A minor fixture-section description was corrected in the evaluation document. These are local results only: no native CI jobs, real-model evaluation, publication, push, or merge occurred. See [EVALUATION.md](EVALUATION.md) and [UPGRADING.md](UPGRADING.md) for reproducible procedures and remaining gates.

### Phase 3 local verification record — 2026-11-10

Verified locally on macOS ARM64 with Node.js 22.23.3 and Bun 1.4.4. A clean export of staged project files, with a fresh frozen install and no ignored probes/references or prebuilt output, passed:

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed; dependencies unchanged |
| `bun run typecheck`, `bun run build`, `bun run test:build` | Passed |
| `bun run test:node` | 118 passed, 0 failed, 0 skipped |
| `bun run test:bun` | 118 passed, 0 failed across 10 files; no skipped cases |
| Built public entry imports | Passed in both runtimes |
| README TypeScript example | Ran under Bun and Node with `--experimental-strip-types`; both returned `turn-2` as match, followed by `turn-1` and `turn-3` as context |

The suite retains 98 prior cases and adds 20 Phase 3 cases. Context tests compiled and failed before neighbor support and against the expansion stub; prior default/zero and byte-budget controls remained green. Coverage includes ordinal gaps and endpoints, exact scope, radius/no-recursion, shared anchors, match priority, unique byte omissions, oversized-record continuity, metadata moves, preserved timestamps, detached snapshots, and context persistence across runtimes.

Independent review found no actionable implementation issue. Additional Node public-API probes confirmed context retrieval beyond the branch candidate cap and anchor-rank priority when anchor sequence order is reversed. Documentation was aligned with current behavior. No schema change, new dependency, performance experiment, or remote CI run occurred; the Phase 0 performance gate remains open.

### Phase 2 local verification record — 2026-11-10

Verified locally on macOS ARM64 with Node.js 22.23.3 and Bun 1.4.4. A fresh export of staged files, with a fresh frozen install and no ignored probes/references or prebuilt output, passed:

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed; dependencies unchanged |
| `bun run typecheck`, `bun run build`, `bun run test:build` | Passed |
| `bun run test:node` | 98 passed, 0 failed, 0 skipped |
| `bun run test:bun` | 98 passed, 0 failed across 8 files; no skipped cases |
| Built public entry imports | Passed in Node and Bun |
| README TypeScript example | Ran under Bun and Node with `--experimental-strip-types`; matching IDs, revisions, roles, and branch ranks |

The suite retains 69 previous cases and adds 29 Phase 2 cases. The new tests first compiled and failed against missing search/compiler/fusion stubs in both runtimes. They cover 51 out-of-scope distractors before a scoped target, literal lexical input, RRF scores, UTF-8 ID ties, whole-text byte limits, token diagnostics, empty scopes, query-purpose validation/cancellation, stored-vector corruption, post-inference snapshots, update/delete/reopen, and cross-runtime retrieval equivalence.

Independent review found no remaining actionable issues after correcting an overstatement in architecture documentation. Additional Node/Bun probes verified the candidate caps at limits 1/10/11/99/100 using 501 records, exact ranks/diagnostics, maximum safe byte budgets, and Unicode/literal queries. SQLite error/cause checks also passed. No benchmarks or remote CI lanes were run, and schema version 1 remains unchanged.

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
| macOS x64/ARM64 | Shared package fixtures passed locally on ARM64 only | Hosted ARM64 CI remains unverified; x64 has no configured lane |

If the alternative `bun:sqlite` driver is adopted, Homebrew can install SQLite using `brew install sqlite` and discover its prefix with `brew --prefix sqlite`. Call `Database.setCustomSQLite()` with the resulting `lib/libsqlite3.dylib` path before opening a database. Do not hardcode `/opt/homebrew` or `/usr/local`. The shared better-sqlite3 recommendation does not require this setup; no one-mem configuration option implements it.

Do not omit optional dependencies when installing sqlite-vec: its platform binaries are optional packages. Package version, SQLite build, OS, architecture, and C library affect compatibility. As researched on 2026-11-10, better-sqlite3 13.0.3 bundles N-API binaries and has no install script; advice for older releases may differ. The local probe does not validate every Node.js/Bun version allowed by the package's engine ranges.

## Research and Data

The user selected 10,000 and 100,000 records as initial evaluation sizes while production volume remains unknown. [Local benchmarks](BENCHMARKS.md) retain the synthetic in-memory scalar/vec0 comparison and add file-backed insertion, updates, checkpointed disk size, and benchmark-only dense/FTS5/RRF timings. These are warm-cache synthetic fixtures, not cold-disk, representative corpus, concurrent, embedding-generation, or complete application measurements. They establish no capacity guarantee.

The original Phase 0 representative-workload gate remains unresolved: no production corpus or agreed latency budget was supplied. The recorded 384-dimensional workload and 100 ms warm hybrid p95 threshold are provisional local engineering assumptions. The threshold **failed for unfiltered and 50%-selected 100k queries in both runtimes** (unfiltered p95: Node 105.668 ms, Bun 113.431 ms). Measurement execution is complete, but performance acceptance remains open; resolve workload/budget and attribute the miss before freezing a durable Phase 1 schema. The combined timings do not show that changing to `vec0` is necessary or sufficient, so the inline baseline remains provisional.

The user's subsequent continuation authorizes Phase 1 functionality on this baseline, with an explicit distinction between versioned file persistence and a production schema-compatibility freeze. That continuation does not turn the failed threshold into a passed gate. No performance experiment was repeated for Phase 1, and Phase 0 timings must not be relabeled as measurements of the new ingestion API.

Phase 2 likewise adds functionality without repeating the benchmark or changing its threshold. Its behavioral tests do not measure public-API latency, real-model retrieval quality, or production-scale suitability. The original 100k p95 misses remain open evidence, not measurements of this new search implementation.

Phase 3 adds context correctness tests without repeating those measurements. Neighbor expansion has no measured production latency or quality benefit yet; it does not resolve the earlier 100k gate or demonstrate parity with the paper's graph/hierarchy closure.

Phase 4 evaluates only 33 authored records/19 queries with manual eight-dimensional vectors, cap 50, limit 2, and 180 evidence bytes. Its tiny warm-cache timings include internal trace collection and cannot replace the earlier 100k/384-dimensional evidence. The final reports were regenerated once to correct provenance metadata, not to select better timing results. No real model, licensed external corpus, reader, or paid API was used. Scope checks passed locally, but no-answer cases still returned evidence in some variants; the core does not promise abstention or factual reasoning.

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

## Phase 2 Behavioral Boundaries

- Dense ranking is an exact O(eligible records × dimensions) scalar scan, not approximate/sublinear search. FTS5 corpus statistics belong to the database; source/session filters constrain eligible candidates before ranking limits but do not create independent per-source FTS statistics.
- Up to 50–500 candidates per branch enter fixed equal-weight RRF. Relevant evidence outside those candidates cannot be recovered by fusion or the final byte selector. Numeric RRF scores are not calibrated confidence, and nonempty dense retrieval does not promise abstention on unrelated queries.
- The lexical compiler caps 32 distinct lowercase letter/number/underscore tokens and safely quotes them. `unicode61 remove_diacritics 0` retains accents, but Unicode normalization/case folding, Vietnamese segmentation, and code-symbol behavior are not a full linguistic or identifier analysis. Synthetic language cases establish behavior only.
- The default 16,384-byte cap counts returned original text in UTF-8, including repeated text under different IDs. It excludes metadata, the query, prompt syntax, and tokenizer overhead. Whole oversized records are omitted, not compressed or truncated; this can exclude relevant evidence. Zero bytes returns no items while still reporting candidate/budget diagnostics for a nonempty scope.
- Evidence is a detached snapshot after query inference. It carries namespace, caller IDs, revisions, ranks, and scores; later updates do not rewrite prior results. Citation identity validates provenance, not factual truth or completeness. Query embeddings still incur any provider-defined cost and privacy exposure.
- Phase 2 initially returned only matches; Phase 3 adds the context behavior below. Graph traversal, reader calls, and learned reranking remain absent. Search rejects unsupported options rather than silently ignoring them. No schema, native dependency, or platform-support expansion is implied.

## Phase 3 Behavioral Boundaries

- Neighbor radius is limited to two ordinals on each side of each selected match and defaults to zero. A missing ordinal stops that direction; another source/session, a timestamp, or a speaker label cannot bridge the gap. Context does not recursively expand or recover distant relational support.
- Match selection consumes the byte budget first. The match limit does not cap the combined match/context count, but every returned record shares the same whole-text UTF-8 cap. Relevant context may be omitted for size; omission does not remove the stored record or create an ordinal gap.
- Context has null relevance score and empty branch ranks. Its `anchorIds` identify selected matches that requested it, not proof that it is relevant or factually supports an answer. Shared context uses bytes once; identical text under different record IDs remains distinct evidence.
- `budgetOmitted` counts distinct IDs inspected and rejected for bytes across match/context selection. It does not count all unreturned database rows or records excluded only by the match limit. A context record already rejected during the match pass is not counted again.
- Results are detached snapshots from one read transaction after query inference. Later changes affect subsequent searches; they do not rewrite old evidence. Stored observation/event times are preserved and do not establish chronological fact precedence. Real-model quality, crash recovery, and additional platform evidence remain pending.

## Remaining Acceptance and Release Work

- Run the configured native CI lanes, including packaged-artifact installation and evaluation, before expanding support statements beyond local macOS ARM64. No remote jobs ran during this implementation; Windows ARM64 remains excluded and Linux musl remains unverified.
- Choose a real embedding provider and representative licensed corpus/query-support set. Keep held-out labels separate, measure provider cost/latency and complete evidence coverage, and agree on the production workload and latency budget. The Phase 0 p95 gate is still open.
- The schema-v1 fixture and rollback/backup/rebuild tests do not implement a v1→v2 migration. Add genuine old-version upgrade tests before the first future schema change. Follow [UPGRADING.md](UPGRADING.md); live-file copying and power-loss recovery are not validated.
- Keep publication disabled until the native matrix, compatibility/versioning policy, backup process, and workload gates are accepted. Optional experiments require their documented trigger and a focused follow-up plan; the synthetic fixture alone does not justify implementing them.

## Sources

[Bun SQLite](https://bun.com/docs/runtime/sqlite), [sqlite-vec JavaScript guide](https://alexgarcia.xyz/sqlite-vec/js.html), [sqlite-vec package metadata](https://registry.npmjs.org/sqlite-vec/0.1.9), [better-sqlite3 package metadata](https://registry.npmjs.org/better-sqlite3/13.0.3).
