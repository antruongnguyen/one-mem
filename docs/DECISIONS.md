# Decisions

Recorded on 2026-11-10. Accepted decisions govern this repository; provisional choices require implementation evidence.

## D001 — Independent Implementation

**Status: Accepted.** one-mem is the main project. The sibling zero-mem checkout is a read-only reference, not a runtime dependency. Write code and prompts independently. Preserve links to the paper and inspected reference revision; do not claim official status or benchmark parity.

## D002 — One TypeScript ESM Package

**Status: Accepted.** Use strict TypeScript, standard ES modules, and `tsc` to generate JavaScript and declarations. Bun manages development dependencies and the lockfile. Baselines are Node.js 22+ and Bun 1.4+; Windows x64, Linux, and macOS are verification targets, not compatibility claims based on compilation. Windows ARM64 is out of scope.

Prefer standard JavaScript and Node-compatible APIs in shared code. Keep dependencies minimal. The bootstrap has no public API, server, CLI, or monorepo. Package publishing is disabled with `private: true` until the API and release process exist.

## D003 — SQLite and sqlite-vec

**Status: Accepted; Phase 0 shared driver implemented.** Use SQLite for durable source records and derived metadata, with sqlite-vec for vector search. Learn from the reference's ideas rather than reproducing its file formats or internal algorithms.

| Approach | Benefit | Tradeoff |
| --- | --- | --- |
| `better-sqlite3` on both (implemented) | One integration; verified locally without a custom dylib | Windows/Linux and other versions still need native results |
| `better-sqlite3` on Node; `bun:sqlite` on Bun | Uses each runtime's native SQLite interface | Two adapters; custom SQLite required on macOS Bun |
| `node:sqlite` on Node | Removes a Node driver dependency | Changes the integration baseline and requires separate validation |

The root package pins better-sqlite3 13.0.3 and sqlite-vec 0.1.9. Reproducible compiled fixtures promote the earlier isolated macOS ARM64 probe into project tests for both runtimes. Keep optional dependencies installed. This driver release bundles N-API binaries with no install script or TypeScript declarations; pinned driver typings are required, and no additional lifecycle-script trust is needed.

Internal `openStorage(path)` returns the concrete driver connection, with bigint results, foreign keys, a 5,000 ms busy timeout, and WAL for local file databases. It loads the extension before returning; native availability failures preserve their cause and do not trigger a second driver or lexical-only fallback. There is no public memory API or durable schema in Phase 0.

## D004 — Incremental Memory Pipeline

**Status: Revised recommendation.** Implement durable ingestion, exact vector retrieval, FTS5 lexical retrieval, reciprocal rank fusion, and bounded context from explicit source/session metadata. Keep generative LLM calls outside ingestion and retrieval. Use a caller-supplied embedding provider initially; do not bundle a model runtime by default.

Graph/PPR, NER, precomputed windows/episodes, cross-encoders, and a final reader are optional follow-up experiments. Promote them only after held-out evaluation shows gains against the hybrid baseline at comparable evidence budgets. Do not port dataset-specific query or answer-rewriting heuristics as defaults.

Reading [paper v1](https://arxiv.org/pdf/2607.29377v1) strengthens the priority of a scoped graph/relational-support experiment for distributed-evidence failures. Its ablation compares graph and hierarchy variants of its full model, not one-mem's hybrid baseline. RRF plus neighbors remains a deliberate simplification whose quality must be measured independently. Evaluation will distinguish primary candidates from expanded/final evidence, and isolate encoder, storage, retrieval, final-reader, and end-to-end costs. See [PAPER_ANALYSIS.md](PAPER_ANALYSIS.md).

The recommended first scope and database layout are design proposals, not existing functionality or user-imposed scale requirements. The [reference analysis](REFERENCE_ANALYSIS.md) explains alternatives; the [implementation plan](IMPLEMENTATION_PLAN.md) defines contracts and acceptance gates.

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

## Evidence

- [Zero-Mem paper, v1](https://arxiv.org/pdf/2607.29377v1)
- [Bun SQLite documentation](https://bun.com/docs/runtime/sqlite)
- [sqlite-vec JavaScript integrations](https://alexgarcia.xyz/sqlite-vec/js.html)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [Node.js 22 SQLite documentation](https://nodejs.org/docs/latest-v22.x/api/sqlite.html)
