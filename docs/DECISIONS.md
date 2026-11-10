# Decisions

Recorded on 2026-11-10. Accepted decisions govern this repository; provisional choices require implementation evidence.

## D001 — Independent Implementation

**Status: Accepted.** one-mem is the main project. The sibling zero-mem checkout is a read-only reference, not a runtime dependency. Write code and prompts independently. Preserve links to the paper and inspected reference revision; do not claim official status or benchmark parity.

## D002 — One TypeScript ESM Package

**Status: Accepted.** Use strict TypeScript, standard ES modules, and `tsc` to generate JavaScript and declarations. Bun manages development dependencies and the lockfile. Baselines are Node.js 22+ and Bun 1.4+; Windows x64, Linux, and macOS are verification targets, not compatibility claims based on compilation. Windows ARM64 is out of scope.

Prefer standard JavaScript and Node-compatible APIs in shared code. Keep dependencies minimal. Phase 1 exposes the ingestion/lifecycle API; there is no server, CLI, or monorepo. Package publishing remains disabled with `private: true` until the API and release process are ready.

## D003 — SQLite and sqlite-vec

**Status: Accepted; Phase 0 shared driver implemented.** Use SQLite for durable source records and derived metadata, with sqlite-vec for vector search. Learn from the reference's ideas rather than reproducing its file formats or internal algorithms.

| Approach | Benefit | Tradeoff |
| --- | --- | --- |
| `better-sqlite3` on both (implemented) | One integration; verified locally without a custom dylib | Windows/Linux and other versions still need native results |
| `better-sqlite3` on Node; `bun:sqlite` on Bun | Uses each runtime's native SQLite interface | Two adapters; custom SQLite required on macOS Bun |
| `node:sqlite` on Node | Removes a Node driver dependency | Changes the integration baseline and requires separate validation |

The root package pins better-sqlite3 13.0.3 and sqlite-vec 0.1.9. Reproducible compiled fixtures promote the earlier isolated macOS ARM64 probe into project tests for both runtimes. Keep optional dependencies installed. This driver release bundles N-API binaries with no install script or TypeScript declarations; pinned driver typings are required, and no additional lifecycle-script trust is needed.

Internal `openStorage(path)` returns the concrete driver connection, with bigint results, foreign keys, a 5,000 ms busy timeout, and WAL for local file databases. It loads the extension before returning; native availability failures preserve their cause and do not trigger a second driver or lexical-only fallback. Phase 1 defers WAL configuration until database ownership/version checks complete, so rejecting an incompatible database does not change its journal mode.

## D004 — Incremental Memory Pipeline

**Status: Revised recommendation.** Implement durable ingestion, exact vector retrieval, FTS5 lexical retrieval, reciprocal rank fusion, and bounded context from explicit source/session metadata. Keep generative LLM calls outside ingestion and retrieval. Use a caller-supplied embedding provider initially; do not bundle a model runtime by default.

Graph/PPR, NER, precomputed windows/episodes, cross-encoders, and a final reader are optional follow-up experiments. Promote them only after held-out evaluation shows gains against the hybrid baseline at comparable evidence budgets. Do not port dataset-specific query or answer-rewriting heuristics as defaults.

Reading [paper v1](https://arxiv.org/pdf/2607.29377v1) strengthens the priority of a scoped graph/relational-support experiment for distributed-evidence failures. Its ablation compares graph and hierarchy variants of its full model, not one-mem's hybrid baseline. RRF plus neighbors remains a deliberate simplification whose quality must be measured independently. Evaluation will distinguish primary candidates from expanded/final evidence, and isolate encoder, storage, retrieval, final-reader, and end-to-end costs. See [PAPER_ANALYSIS.md](PAPER_ANALYSIS.md).

Phase 1 implements namespace-owned records, embeddings, and transactional FTS maintenance. Phase 2 adds scoped hybrid retrieval and bounded matched evidence; context expansion remains planned. The 10k/100k measurements are evaluation sizes rather than supported-capacity requirements. The [reference analysis](REFERENCE_ANALYSIS.md) explains alternatives; the [implementation plan](IMPLEMENTATION_PLAN.md) defines contracts and acceptance gates.

## D005 — Documentation and Collaboration

**Status: Accepted.** User-facing conversation is Vietnamese. Repository documents, code prompts, and subagent prompts are English. Use subagents with model and effort matched to task difficulty, as defined in [AGENTS.md](../AGENTS.md).

Use Conventional Commits and branches such as `feat/sqlite-storage`. Never add co-author trailers. Keep durable decisions in `docs/`; ignore `docs/superpowers/` scratch plans. License independently authored material under MIT, as selected by the project owner.

## D006 — Phase 0 Layout and Evidence Boundary

**Status: Accepted initial baseline; production suitability remains provisional.** Retain inline Float32 vector BLOBs with scalar cosine search, applying source/session predicates before top-k. Existing 10k/100k measurements show a workload-dependent tradeoff: `vec0` helps broad scans, while indexed scalar queries help selective scopes. No concrete production workload currently justifies separate vector-table maintenance. Do not ship two engines or repeat that completed comparison without a new question.

The Phase 0 file-backed benchmark adds the previously missing insertion, text/vector update, checkpointed file size, and dense/FTS rank-fusion measurement through the implemented connection. It reuses the existing deterministic 384-dimensional vector workload and hashes. The hybrid SQL and temporary schema are benchmark fixtures, not a product retrieval API or migration contract.

**Material plan adjustment:** no representative production corpus, query/update distribution, or agreed latency budget is available. For the local engineering gate only, use synthetic text/scopes and a provisional **100 ms warm hybrid p95** threshold declared before running. The fixture selects 10 final rows from 50 candidates per branch with RRF constant 60. [BENCHMARKS.md](BENCHMARKS.md) records measured results and limits. This substitution does not satisfy the original production-workload gate; validate actual embeddings, text lengths, filters, and latency requirements before treating the Phase 1 schema as durable. No capacity or performance-superiority claim follows.

**Measured outcome:** the 100k unfiltered and 50% cases exceed the provisional threshold in both runtimes (unfiltered p95: Node 105.668 ms, Bun 113.431 ms). The threshold remains unchanged and performance acceptance remains open. Keep scalar provisionally: these combined hybrid timings do not attribute the miss or demonstrate that vec0 would resolve it. The completed measurements are a limitation to carry forward, not a passed performance gate.

## D007 — Configured Coverage and Executed Evidence

**Status: Accepted.** CI configures five native baseline targets at Node.js 22.23.3 and Bun 1.4.4, plus Linux x64 using current Node LTS and latest Bun. Each lane installs both runtimes, asserts the actual architecture, and runs both compiled suites including database exchange. Linux lanes assert glibc. Missing runtimes or mismatched architectures fail instead of becoming skipped passes.

Local macOS ARM64 execution is the available package evidence. Windows x64, Linux glibc x64/ARM64, macOS x64, and the current-runtime lane are configured but have not run in this local task. Native CI results must precede expanded support claims; Windows ARM64 remains excluded and Linux musl remains unverified.

## D008 — Phase 1 Persistence Without a Production Schema Freeze

**Status: Accepted on continuation.** After the Phase 0 report explicitly identified the open performance gate, the user requested the next phase. Implement Phase 1 on the same inline BLOB baseline: `openMemory`, `upsert`, `get`, `remove`, and `close`, with schema version 1 and persisted namespace/embedding-space identity. File persistence and reopen are supported by the implementation; the private package does not yet promise schema compatibility across releases or production suitability. The Phase 0 threshold is unchanged and no completed benchmark is repeated.

Initialize version 1 only in an empty version-0 database, atomically creating settings, records, and external-content FTS5 with maintenance triggers. Reject unrelated or incompatible databases, and newer schema versions, before changing persistent pragmas. No automatic model migration or re-embedding occurs on open. A different model identity/dimension/metric requires a new database.

Upsert snapshots and validates the whole batch, hashes canonical fields, and performs embedding outside SQL transactions. Reuse vectors for metadata-only corrections; unchanged canonical input retains its UUID revision. Recheck all affected revisions in one write transaction and replace changed rows atomically, including ordinal swaps. Later observations receive new caller IDs; correcting an existing ID changes its revision and does not retain the replaced content as history.

Operations on one handle are serialized. Closing stops admission, drains accepted operations, and closes once; repeated close is allowed. Cancellation before commit propagates the signal reason and writes nothing; a completed commit remains successful. Providers that ignore cancellation can delay close. Provider failures retain their cause, with no retry or fallback. Freeze only the private embedding-space snapshot, never the caller's provider object, and reject descriptor changes before and after embedding.

Timestamps require a valid Gregorian date, time with seconds, and explicit `Z` or `±HH:MM` offset. Canonical storage uses JavaScript UTC ISO strings at millisecond precision. Original record text and identifiers are preserved exactly. Reject unpaired UTF-16 surrogates in persisted strings before embedding or SQLite binding: SQLite's UTF-8 conversion would otherwise replace them and could alias distinct IDs. Valid astral Unicode remains supported. Search, ranking, and evidence budgets were deferred to Phase 2; neighbors remain Phase 3 work.

## D009 — Phase 2 Scoped Hybrid Retrieval and Evidence

**Status: Accepted.** `search` combines exact scalar cosine and FTS5 candidates from schema version 1. Both branches apply source/session predicates before their candidate limit, `min(500, max(50, 5 * limit))`. A session filter requires its source. Dense distances and BM25 both rank ascending, with binary caller-ID ties. Equal-weight reciprocal rank fusion sums `1 / (60 + rank)`; final ties compare UTF-8 bytes to match SQLite `COLLATE BINARY`, including astral Unicode IDs. RRF scores are rank contributions, not confidence probabilities or similarity thresholds.

Lexical input is compiled into quoted literal phrases joined with `OR`, using at most 32 distinct lowercase Unicode letter/number/underscore tokens in first-occurrence order. Truncation means a 33rd distinct token exists. Original query and stored record text remain unchanged; punctuation-only queries can still retrieve dense candidates. This does not claim exact tokenizer parity, Vietnamese segmentation, or code-symbol understanding. No raw query syntax reaches FTS `MATCH`.

Validate query/options, cancellation, and the provider space before any empty-scope return. Empty eligible scopes skip embedding; otherwise query inference uses `purpose: "query"` outside SQL transactions. Both ranked branches, current records, and detached evidence are materialized in one synchronous read transaction after inference. Writes during inference are visible in that later snapshot. Provider failures propagate with their cause and never become lexical-only success; detected NULL/nonfinite stored-vector distances fail instead of silently ranking first.

Search defaults to 10 matches and 16,384 UTF-8 text bytes. `limit` is an integer from 1 through 100; `maxEvidenceBytes` is a nonnegative safe integer. Whole records are selected in fused order; oversized records are skipped so later smaller records can fit. `budgetOmitted` counts inspected byte-budget skips before the accepted-match limit is reached, not exclusions caused only by the limit. Repeated text under distinct IDs consumes bytes separately. Query, metadata, prompt framing, and model tokens are outside this text-byte cap.

Phase 2 exposes matched records, numeric scores, one-based branch ranks, and diagnostics. Items have `role: "match"`; `anchorIds`, context roles, nullable context scores, and the `neighbors` option wait until Phase 3. Passing `neighbors` now is an input error. The private API/schema and the Phase 0 performance limitation remain unchanged; no benchmark or quality evaluation was rerun, and no reader, graph, reranker, or new dependency was added.

## Evidence

- [Zero-Mem paper, v1](https://arxiv.org/pdf/2607.29377v1)
- [Bun SQLite documentation](https://bun.com/docs/runtime/sqlite)
- [sqlite-vec JavaScript integrations](https://alexgarcia.xyz/sqlite-vec/js.html)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [Node.js 22 SQLite documentation](https://nodejs.org/docs/latest-v22.x/api/sqlite.html)
