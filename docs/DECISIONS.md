# Decisions

Recorded on 2026-11-10. Accepted decisions govern this repository; provisional choices require implementation evidence.

## D001 — Independent Implementation

**Status: Accepted.** one-mem is the main project. The sibling zero-mem checkout is a read-only reference, not a runtime dependency. Write code and prompts independently. Preserve links to the paper and inspected reference revision; do not claim official status or benchmark parity.

## D002 — One TypeScript ESM Package

**Status: Accepted.** Use strict TypeScript, standard ES modules, and `tsc` to generate JavaScript and declarations. Bun manages development dependencies and the lockfile. Baselines are Node.js 22+ and Bun 1.4+; Windows x64, Linux, and macOS are verification targets, not compatibility claims based on compilation. Windows ARM64 is out of scope.

Prefer standard JavaScript and Node-compatible APIs in shared code. Keep dependencies minimal. The bootstrap has no public API, server, CLI, or monorepo. Package publishing is disabled with `private: true` until the API and release process exist.

## D003 — SQLite and sqlite-vec

**Status: Accepted storage direction; revised driver recommendation.** Use SQLite for durable source records and derived metadata, with sqlite-vec for vector search. Learn from the reference's ideas rather than reproducing its file formats or internal algorithms.

| Approach | Benefit | Tradeoff |
| --- | --- | --- |
| `better-sqlite3` on both (recommended) | One integration; verified locally without a custom dylib | Windows/Linux and other versions still need native tests |
| `better-sqlite3` on Node; `bun:sqlite` on Bun | Uses each runtime's native SQLite interface | Two adapters; custom SQLite required on macOS Bun |
| `node:sqlite` on Node | Removes a Node driver dependency | Changes the integration baseline and requires separate validation |

An isolated probe on macOS ARM64 passed with Node.js 22.23.3, Bun 1.4.4, better-sqlite3 13.0.3, sqlite-vec 0.1.9, and SQLite 3.53.4. It covered vector queries, FTS5, rollback, deletion, and databases exchanged between runtimes. This supports starting with one driver; it does not establish cross-platform support or superior performance. No SQLite dependency has been added to the root package. See the [implementation plan](IMPLEMENTATION_PLAN.md) for the storage gate and reproducible production test requirements.

## D004 — Incremental Memory Pipeline

**Status: Revised recommendation.** Implement durable ingestion, exact vector retrieval, FTS5 lexical retrieval, reciprocal rank fusion, and bounded context from explicit source/session metadata. Keep generative LLM calls outside ingestion and retrieval. Use a caller-supplied embedding provider initially; do not bundle a model runtime by default.

Graph/PPR, NER, precomputed windows/episodes, cross-encoders, and a final reader are optional follow-up experiments. Promote them only after held-out evaluation shows gains against the hybrid baseline at comparable evidence budgets. Do not port dataset-specific query or answer-rewriting heuristics as defaults.

The recommended first scope and database layout are design proposals, not existing functionality or user-imposed scale requirements. The [reference analysis](REFERENCE_ANALYSIS.md) explains alternatives; the [implementation plan](IMPLEMENTATION_PLAN.md) defines contracts and acceptance gates.

## D005 — Documentation and Collaboration

**Status: Accepted.** User-facing conversation is Vietnamese. Repository documents, code prompts, and subagent prompts are English. Use subagents with model and effort matched to task difficulty, as defined in [AGENTS.md](../AGENTS.md).

Use Conventional Commits and branches such as `feat/sqlite-storage`. Never add co-author trailers. Keep durable decisions in `docs/`; ignore `docs/superpowers/` scratch plans. License independently authored material under MIT, as selected by the project owner.

## Evidence

- [Bun SQLite documentation](https://bun.com/docs/runtime/sqlite)
- [sqlite-vec JavaScript integrations](https://alexgarcia.xyz/sqlite-vec/js.html)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [Node.js 22 SQLite documentation](https://nodejs.org/docs/latest-v22.x/api/sqlite.html)
